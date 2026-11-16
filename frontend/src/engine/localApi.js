// In-app implementation of the CareerForge API (same routes and JSON as internal/server),
// used when no Go server is reachable: the Android/iOS apps and static web hosting.
// Data lives on the device in IndexedDB.
import { get, set, del } from 'idb-keyval';
import { processResume } from './process.js';
import { buildQualityReport } from './quality.js';
import { textFromFile } from './extract.js';
import { chunkJobDescription, generateAnswer } from './llm.js';

const DOC_EXT = ['pdf', 'docx', 'txt', 'md', 'epub'];
const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
const K = { users: 'cf:users', profiles: 'cf:profiles', sessions: 'cf:sessions', files: 'cf:files' };

const extOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const nowIso = () => new Date().toISOString();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const text = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

async function load(key) { return (await get(key)) || {}; }

// ---- object URLs for stored files (valid for this app session) ----
const urlCache = new Map();
async function fileUrl(fileId) {
  if (urlCache.has(fileId)) return urlCache.get(fileId);
  const blob = await get(`cf:blob:${fileId}`);
  if (!blob) return '#';
  const url = URL.createObjectURL(blob);
  urlCache.set(fileId, url);
  return url;
}

async function publicFile(meta) {
  return {
    file_id: meta.file_id, file_role: meta.file_role, original_name: meta.original_name,
    public_url: await fileUrl(meta.file_id), extension: meta.extension, size_bytes: meta.size_bytes, created_at: meta.created_at,
  };
}

async function storeFile(file, { sessionId = '', ownerId = '', role }) {
  const files = await load(K.files);
  const fileId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  files[fileId] = {
    file_id: fileId, session_id: sessionId, owner_user_id: ownerId, file_role: role, original_name: file.name,
    extension: extOf(file.name), size_bytes: file.size || 0, mime_type: file.type || '', created_at: nowIso(),
  };
  await set(`cf:blob:${fileId}`, file);
  await set(K.files, files);
  return files[fileId];
}

// ---- password hashing: same scheme as the Go server ----
// v2$<iterations>$<salt hex>$<PBKDF2-HMAC-SHA256 hex>; legacy v1$<salt>$<sha256> still verifies.
export const PBKDF2_ITERATIONS = 210000;
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => new Uint8Array((hex.match(/.{2}/g) || []).map((h) => parseInt(h, 16)));
async function pbkdf2Hex(password, saltBytes, iterations, bytes = 32) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, bytes * 8));
}
export async function hashPassword(password) {
  const salt = randomHex(16);
  return `v2$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2Hex(password, hexToBytes(salt), PBKDF2_ITERATIONS)}`;
}
export async function verifyPassword(stored, password) {
  const parts = String(stored || '').split('$');
  if (parts[0] === 'v2' && parts.length === 4) {
    const iter = Number(parts[1]);
    if (!Number.isInteger(iter) || iter < 1 || iter > 10000000 || !parts[3]) return false;
    return (await pbkdf2Hex(password, hexToBytes(parts[2]), iter, parts[3].length / 2)) === parts[3];
  }
  if (parts[0] === 'v1' && parts.length === 3 && parts[1] && parts[2]) {
    const bytes = new Uint8Array([...hexToBytes(parts[1]), ...new TextEncoder().encode(password)]);
    return toHex(await crypto.subtle.digest('SHA-256', bytes)) === parts[2];
  }
  return false;
}
const needsRehash = (stored) => !String(stored || '').startsWith(`v2$${PBKDF2_ITERATIONS}$`);

function validate(file, image) {
  const e = extOf(file.name);
  if (IMG_EXT.includes(e)) {
    if (file.size > 5 * 1024 * 1024) return 'Image file too large. Max is 5MB.';
    return '';
  }
  if (DOC_EXT.includes(e)) {
    if (image) return 'Unsupported file type.';
    if (file.size > 10 * 1024 * 1024) return 'Document file too large. Max is 10MB.';
    return '';
  }
  return 'Unsupported file type.';
}

const profileCompletion = (...fields) => Math.floor((fields.filter(Boolean).length * 100) / fields.length);

// ---- routes ----
const routes = {
  async 'POST /auth/signup'(form) {
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const display = String(form.get('display_name') || '').trim() || 'User';
    if (!email) return json({ error: 'email is required' });
    if (password.length < 6) return json({ error: 'password must be at least 6 characters' });
    const users = await load(K.users);
    if (Object.values(users).some((u) => u.email === email)) return json({ error: 'email already registered' });
    const userId = `u_${randomHex(12)}`;
    users[userId] = { user_id: userId, email, display_name: display, password_hash: await hashPassword(password), auth_provider: 'email' };
    await set(K.users, users);
    return json({ user_id: userId, email, display_name: display, auth_provider: 'email' });
  },

  async 'POST /auth/login'(form) {
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    if (!email || !password) return json({ error: 'email and password are required' });
    const user = Object.values(await load(K.users)).find((u) => u.email === email);
    if (!user || !(await verifyPassword(user.password_hash, password))) return json({ error: 'invalid email or password' });
    if (needsRehash(user.password_hash)) {
      const users = await load(K.users);
      users[user.user_id] = { ...users[user.user_id], password_hash: await hashPassword(password) };
      await set(K.users, users);
    }
    return json({ user_id: user.user_id, email, display_name: user.display_name, auth_provider: user.auth_provider });
  },

  async 'POST /auth/google'(form) {
    // On-device mode: the account and its data never leave this device, so the token is
    // only decoded to read the Google account ID, name and email.
    const cred = String(form.get('credential') || '').trim();
    let claims;
    try {
      claims = JSON.parse(atob(cred.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return json({ error: 'invalid google credential' });
    }
    if (!claims.sub || (claims.exp && Date.now() / 1000 > claims.exp)) return json({ error: 'invalid google credential' });
    const email = String(claims.email || '').toLowerCase();
    const name = claims.name || 'Google User';
    const users = await load(K.users);
    let user = Object.values(users).find((u) => u.google_sub === claims.sub) || (email && Object.values(users).find((u) => u.email === email));
    if (!user) {
      const userId = `u_${randomHex(12)}`;
      user = { user_id: userId, email, display_name: name };
      users[userId] = user;
    }
    Object.assign(user, { google_sub: claims.sub, auth_provider: 'google', display_name: user.display_name || name, email: email || user.email });
    await set(K.users, users);
    return json({ user_id: user.user_id, email: user.email, display_name: user.display_name, auth_provider: 'google' });
  },

  async 'POST /notifications/test-email'(form) {
    if (!String(form.get('to_email') || '').trim()) return json({ error: 'to_email is required' });
    return json({ ok: false, detail: 'Email notifications are not available in on-device mode' });
  },

  async 'GET /dashboard/:id'(_, userId) {
    const users = await load(K.users);
    const profiles = await load(K.profiles);
    const sessions = Object.values(await load(K.sessions)).filter((s) => s.user_id === userId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    // Same as the Go server: 404 only when there is no account and nothing analysed yet.
    if (!users[userId] && !sessions.length) return json({ error: 'Profile not found' }, 404);
    const user = users[userId] || { user_id: userId };
    const profile = profiles[userId] || {};
    const files = Object.values(await load(K.files)).filter((f) => f.owner_user_id === userId && f.session_id)
      .sort((a, b) => b.file_id - a.file_id);
    const recent = sessions.slice(0, 15).map((sess) => {
      const rep = buildQualityReport(sess);
      return { session_id: sess.session_id, created_at: sess.created_at, quality_score: rep ? rep.quality_score : null, keyword_coverage: rep ? rep.keyword_coverage : null };
    });
    const scores = recent.map((r) => r.quality_score).filter((v) => v !== null);
    return json({
      app_name: 'CareerForge',
      profile_completion: profileCompletion(user.display_name, user.email, profile.headline, profile.bio, profile.image_file_id),
      sessions_count: sessions.length,
      files_count: files.length,
      analyzed_sessions: scores.length,
      average_quality_score: scores.length ? Math.floor(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      recent_uploads: await Promise.all(files.slice(0, 8).map(publicFile)),
      recent_sessions: recent,
    });
  },

  async 'POST /analysis/quality'(form) {
    const sid = String(form.get('session_id') || '').trim();
    if (!sid) return json({ error: 'session_id is required' });
    const report = buildQualityReport((await load(K.sessions))[sid]);
    return report ? json(report) : json({ error: 'Quality report not ready for this session' });
  },

  async 'POST /profile/upsert'(form) {
    const userId = String(form.get('user_id') || '').trim();
    if (!userId) return json({ error: 'user_id is required' });
    const users = await load(K.users);
    const profiles = await load(K.profiles);
    const email = String(form.get('email') || '').trim();
    const display = String(form.get('display_name') || '').trim() || 'User';
    users[userId] = { ...(users[userId] || { user_id: userId }), email: email || users[userId]?.email || '', display_name: display };
    const profile = { ...(profiles[userId] || {}), headline: String(form.get('headline') || '').trim(), bio: String(form.get('bio') || '').trim() };
    const image = form.get('profile_image');
    if (image && typeof image !== 'string' && image.size) {
      const problem = validate(image, true);
      if (problem || !IMG_EXT.includes(extOf(image.name))) return json({ error: problem || 'Profile image must be an image file.' });
      if (profile.image_file_id) await del(`cf:blob:${profile.image_file_id}`);
      profile.image_file_id = (await storeFile(image, { ownerId: userId, role: 'profile_image' })).file_id;
    }
    profiles[userId] = profile;
    await set(K.users, users);
    await set(K.profiles, profiles);
    return json({
      user_id: userId, email, display_name: display, headline: profile.headline, bio: profile.bio,
      profile_image_url: profile.image_file_id ? await fileUrl(profile.image_file_id) : null,
    });
  },

  async 'GET /profile/:id'(_, userId) {
    const user = (await load(K.users))[userId] || { user_id: userId };
    const profile = (await load(K.profiles))[userId] || {};
    const files = Object.values(await load(K.files)).filter((f) => f.owner_user_id === userId && f.session_id)
      .sort((a, b) => b.file_id - a.file_id);
    return json({
      profile: {
        user_id: userId, email: user.email || '', display_name: user.display_name || '', headline: profile.headline || '',
        bio: profile.bio || '', profile_image_url: profile.image_file_id ? await fileUrl(profile.image_file_id) : '',
      },
      files: await Promise.all(files.map(publicFile)),
    });
  },

  async 'POST /upload'(form) {
    const sid = String(form.get('session_id') || '').trim();
    const uid = String(form.get('user_id') || '').trim();
    const resume = form.get('resume');
    const jd = form.get('jd');
    if (!sid || !resume || !jd || typeof resume === 'string' || typeof jd === 'string') return json({ error: 'Missing session_id or files' });
    for (const [file, label] of [[resume, 'resume'], [jd, 'jd']]) {
      const problem = validate(file, false);
      if (problem) return json({ error: `${label}: ${problem}` });
    }
    let resumeText;
    let jdText;
    try {
      [resumeText, jdText] = await Promise.all([textFromFile(resume), textFromFile(jd)]);
    } catch (error) {
      return text(String(error.message || error), 422);
    }
    const sessions = await load(K.sessions);
    sessions[sid] = {
      session_id: sid, user_id: uid || null, created_at: nowIso(),
      resume: processResume(resumeText), jd: await chunkJobDescription(jdText),
    };
    await set(K.sessions, sessions);
    const r = await storeFile(resume, { sessionId: sid, ownerId: uid, role: 'resume' });
    const j = await storeFile(jd, { sessionId: sid, ownerId: uid, role: 'jd' });
    return json({ message: 'Upload received. Analysis complete.', resume_url: await fileUrl(r.file_id), jd_url: await fileUrl(j.file_id) });
  },

  async 'POST /query'(form) {
    const sid = String(form.get('session_id') || '').trim();
    const prompt = String(form.get('prompt') || '').trim();
    if (!sid || !prompt) return text('Missing session_id or prompt', 400);
    const session = (await load(K.sessions))[sid];
    if (!session?.resume?.length || !session?.jd?.length) return text('Session not found', 404);
    const resume = session.resume.slice(0, 4).map((c) => c.chunk_text).join('\n');
    const jd = session.jd.slice(0, 4).map((c) => c.chunk_text).join('\n');
    const detailed = ['guarantee', 'step by step', 'in detail', 'what should i do', 'how can i improve', 'explain deeply', 'detailed']
      .some((k) => prompt.toLowerCase().includes(k));
    const fullPrompt = detailed ? detailedPrompt(prompt, resume, jd) : briefPrompt(prompt, resume, jd);
    return text(await generateAnswer(prompt, fullPrompt));
  },
};

const briefPrompt = (q, resume, jd) => `You are a professional career advisor.

Answer the question clearly and concisely.

RULES:
- Keep the response SHORT (max 120 words)
- Use bullet points only
- No long explanations
- No repetition
- Be direct and practical

STRUCTURE:
## Verdict
(one line)

## Key Strengths
- max 3 bullet points

## Key Gaps
- max 2 bullet points

User Question:
${q}

Resume:
${resume}

Job Description:
${jd}`;

const detailedPrompt = (q, resume, jd) => `You are a professional career advisor.

Give a detailed, structured analysis.

RULES:
- Use clear Markdown headings
- Use bullet points
- Explain briefly under each point
- Avoid unnecessary repetition

STRUCTURE:
## Overall Verdict
(short paragraph)

## Strengths & Matches
- bullets with explanation

## Gaps / Areas to Improve
- bullets with explanation

## What to Do to Strengthen Qualification
- actionable steps

User Question:
${q}

Resume:
${resume}

Job Description:
${jd}`;

/** Handle a request like fetch() would, against on-device storage. */
export async function localFetch(path, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const url = new URL(path, 'http://local');
  const parts = url.pathname.split('/').filter(Boolean);
  const form = init.body instanceof FormData ? init.body : new FormData();
  let key = `${method} ${url.pathname.replace(/\/$/, '')}`;
  let param;
  if ((parts[0] === 'profile' && parts[1] && parts[1] !== 'upsert') || parts[0] === 'dashboard') {
    key = `${method} /${parts[0]}/:id`;
    param = decodeURIComponent(parts[1] || '');
  }
  const handler = routes[key];
  if (!handler) return json({ error: 'Not found' }, 404);
  try {
    return await handler(form, param);
  } catch (error) {
    return text(String(error.message || error), 500);
  }
}
