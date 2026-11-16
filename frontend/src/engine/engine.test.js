// @vitest-environment node
// On-device engine tests: numeric parity with the Go server, password hashing, and the
// localApi routes exercised as a black box (the same requests the UI sends).
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { buildQualityReport, coveragePercent } from './quality.js';
import { localFetch, hashPassword, verifyPassword, PBKDF2_ITERATIONS } from './localApi.js';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../../tests/fixtures/quality_cases.json', import.meta.url)), 'utf8'));

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}
if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:test';

const form = (fields) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.append(k, v));
  return f;
};
const post = (path, fields) => localFetch(path, { method: 'POST', body: form(fields) });

describe('numeric parity with the Go engine (tests/fixtures/quality_cases.json)', () => {
  it.each(fixture.coverage_percent)('coveragePercent(%i, %i) = %i', (hits, total, want) => {
    expect(coveragePercent(hits, total)).toBe(want);
  });

  it.each(fixture.reports.map((r) => [r.name, r]))('%s', (_, tc) => {
    const rep = buildQualityReport({
      resume: tc.resume.map(([section, chunk_text]) => ({ section, chunk_text })),
      jd: tc.jd.map((chunk_text) => ({ section: 'job_description', chunk_text })),
    });
    const e = tc.expect;
    expect(rep.quality_score).toBe(e.quality_score);
    expect(rep.keyword_coverage).toBe(e.keyword_coverage);
    expect(rep.section_score).toBe(e.section_score);
    expect(rep.action_verb_count).toBe(e.action_verb_count);
    expect(rep.quantified_achievement_count).toBe(e.quantified_achievement_count);
    expect(rep.contact_checks).toEqual(e.contact_checks);
    expect(rep.missing_keywords).toEqual(e.missing_keywords);
    expect(rep.recommendations).toHaveLength(e.recommendation_count);
  });

  it('returns null without both documents', () => {
    expect(buildQualityReport(null)).toBeNull();
    expect(buildQualityReport({ resume: [{ chunk_text: 'x', section: 's' }], jd: [] })).toBeNull();
  });
});

describe('password hashing (same format as the Go server)', () => {
  it('v2 PBKDF2 round trip', async () => {
    const h = await hashPassword('s3cret-pass');
    expect(h.startsWith(`v2$${PBKDF2_ITERATIONS}$`)).toBe(true);
    expect(await verifyPassword(h, 's3cret-pass')).toBe(true);
    expect(await verifyPassword(h, 's3cret-pasS')).toBe(false);
    expect(await hashPassword('s3cret-pass')).not.toBe(h);
  });

  it('matches the RFC PBKDF2-HMAC-SHA256 vector (Go uses the same)', async () => {
    // "passwd" / salt "salt" (hex 73616c74), 1 iteration, first 32 bytes
    const stored = 'v2$1$73616c74$55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc';
    expect(await verifyPassword(stored, 'passwd')).toBe(true);
  });

  it('rejects malformed hashes', async () => {
    for (const h of ['', 'v1$', 'v2$abc$00$00', 'v2$0$00$00', 'plain', 'v3$1$2$3']) {
      expect(await verifyPassword(h, 'x')).toBe(false);
    }
  });
});

describe('localApi black-box (what the UI calls in on-device mode)', () => {
  beforeEach(async () => {
    await clear();
    vi.restoreAllMocks();
  });

  it('signup -> login, case-insensitive email, same error for wrong password and unknown user', async () => {
    const s = await (await post('/auth/signup', { email: 'Aryan@Example.com', password: 'hunter22', display_name: 'Aryan' })).json();
    expect(s.user_id).toBeTruthy();
    expect((await (await post('/auth/signup', { email: 'aryan@example.com', password: 'hunter22' })).json()).error).toBeTruthy();
    expect((await (await post('/auth/login', { email: ' ARYAN@example.com ', password: 'hunter22' })).json()).user_id).toBe(s.user_id);
    const wrong = await (await post('/auth/login', { email: 'aryan@example.com', password: 'nope' })).json();
    const unknown = await (await post('/auth/login', { email: 'nobody@example.com', password: 'nope' })).json();
    expect(wrong.error).toBeTruthy();
    expect(wrong.error).toBe(unknown.error);
  });

  it('signup password length boundary: 5 rejected, 6 accepted', async () => {
    expect((await (await post('/auth/signup', { email: 'a@b.co', password: '12345' })).json()).error).toBeTruthy();
    expect((await (await post('/auth/signup', { email: 'a@b.co', password: '123456' })).json()).user_id).toBeTruthy();
  });

  it('dashboard probe returns a JSON 404 (used by engine detection)', async () => {
    const res = await localFetch('/dashboard/__probe__');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Profile not found');
  });

  it('upload validation: bad extension and missing JD are rejected', async () => {
    const bad = await post('/upload', { session_id: 's1', resume: new File(['MZ'], 'cv.exe'), jd: new File(['Go'], 'jd.txt') });
    expect((await bad.json()).error).toMatch(/resume/);
    const missing = await post('/upload', { session_id: 's1', resume: new File(['x'], 'cv.txt') });
    expect((await missing.json()).error).toBe('Missing session_id or files');
  });

  it('upload validation: 10 MB document limit', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'cv.pdf');
    const res = await post('/upload', { session_id: 's1', resume: big, jd: new File(['Go'], 'jd.txt') });
    expect((await res.json()).error).toMatch(/too large/i);
  });

  it('query validation: 400 without prompt, 404 for unknown session', async () => {
    expect((await post('/query', { session_id: 's' })).status).toBe(400);
    expect((await post('/query', { session_id: 'nope', prompt: 'hi' })).status).toBe(404);
  });

  it('end-to-end: upload text resume + JD -> quality report -> chat answer (no API key)', async () => {
    localStorage.setItem('careerforge_ai_settings_v1', JSON.stringify({ apiKey: '' }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const resume = 'Aryan Singh\naryan@example.com\n+91 98765 43210\nlinkedin.com/in/aryan\n\nSKILLS\nPython Docker Kubernetes Go\n\nEXPERIENCE\nLed a migration and built 3 services, improved latency by 40%\n\nEDUCATION\nB.Tech CSE 2027\n';
    const up = await (await post('/upload', {
      session_id: 's-flow',
      resume: new File([resume], 'cv.txt'),
      jd: new File(['We need Python, Docker and Kubernetes.'], 'jd.txt'),
    })).json();
    expect(up.error).toBeUndefined();
    const rep = await (await post('/analysis/quality', { session_id: 's-flow' })).json();
    expect(rep.quality_score).toBeGreaterThan(0);
    expect(rep.quality_score).toBeLessThanOrEqual(100);
    expect(rep.keyword_coverage).toBeGreaterThanOrEqual(50);
    expect(rep.contact_checks).toEqual({ email: true, phone: true, linkedin: true });
    const ans = await post('/query', { session_id: 's-flow', prompt: 'How can I improve my resume?' });
    expect(ans.status).toBe(200);
    expect((await ans.text()).trim().length).toBeGreaterThan(0);
    // without a key nothing may be sent to Gemini (privacy)
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
