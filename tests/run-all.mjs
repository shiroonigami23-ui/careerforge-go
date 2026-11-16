#!/usr/bin/env node
// CareerForge test runner: runs every suite and records the results.
//
//   node tests/run-all.mjs              # all suites
//   node tests/run-all.mjs --no-e2e     # skip the browser tests
//   node tests/run-all.mjs --no-record  # don't write tests/results/
//
// Suites:
//   go      go test ./...  (unit, numeric, black-box HTTP + security tests of the Go server)
//   engine  vitest         (on-device engine: numeric parity with Go, passwords, localApi black-box, UI smoke)
//   e2e     playwright     (real browser: splash, navigation, upload -> quality -> chat)
//
// Records tests/results/<timestamp>/summary.md + results.json and tests/results/LATEST.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fe = join(root, 'frontend');
const args = new Set(process.argv.slice(2));
const results = [];
const started = Date.now();

function run(cmd, cmdArgs, cwd, env = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

// --- Go ---
console.log('== go test ./...');
{
  const r = run('go', ['test', '-count=1', '-json', './...'], root);
  for (const line of r.out.split('\n')) {
    if (!line.startsWith('{')) continue;
    const ev = JSON.parse(line);
    if (!ev.Test || !['pass', 'fail', 'skip'].includes(ev.Action)) continue;
    const pkg = ev.Package.replace('github.com/shiroonigami23-ui/careerforge-go/', '');
    results.push({ suite: 'go', name: `${pkg} › ${ev.Test}`, status: ev.Action, ms: Math.round((ev.Elapsed || 0) * 1000) });
  }
  if (r.code !== 0 && !results.some((x) => x.suite === 'go' && x.status === 'fail')) {
    results.push({ suite: 'go', name: 'go test (build)', status: 'fail', ms: 0, msg: (r.out + r.err).slice(-800) });
  }
}

// --- vitest ---
console.log('== vitest');
{
  const out = join(fe, 'test-results', 'vitest.json');
  mkdirSync(dirname(out), { recursive: true });
  run('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], fe);
  if (existsSync(out)) {
    const j = JSON.parse(readFileSync(out, 'utf8'));
    for (const f of j.testResults) {
      for (const a of f.assertionResults) {
        results.push({
          suite: 'engine', name: `${f.name.replace(fe + '/', '')} › ${a.fullName}`,
          status: a.status === 'passed' ? 'pass' : a.status === 'skipped' || a.status === 'pending' ? 'skip' : 'fail',
          ms: Math.round(a.duration || 0), msg: (a.failureMessages || []).join(' ').slice(0, 400),
        });
      }
    }
  } else results.push({ suite: 'engine', name: 'vitest', status: 'fail', ms: 0, msg: 'no report' });
}

// --- playwright ---
if (!args.has('--no-e2e')) {
  console.log('== playwright');
  const out = join(fe, 'test-results', 'e2e.json');
  run('npx', ['playwright', 'test'], fe);
  if (existsSync(out)) {
    const walk = (suite, prefix = '') => {
      for (const s of suite.suites || []) walk(s, prefix);
      for (const spec of suite.specs || []) {
        const last = spec.tests[0]?.results?.at(-1) || {};
        results.push({
          suite: 'e2e', name: spec.title, status: last.status === 'passed' ? 'pass' : last.status === 'skipped' ? 'skip' : 'fail',
          ms: last.duration || 0, msg: (last.error?.message || '').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 400),
        });
      }
    };
    walk(JSON.parse(readFileSync(out, 'utf8')));
  } else results.push({ suite: 'e2e', name: 'playwright', status: 'fail', ms: 0, msg: 'no report' });
}

// --- report ---
const count = (s, st) => results.filter((r) => (!s || r.suite === s) && r.status === st).length;
const failed = count(null, 'fail');
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${results.length} tests: ${count(null, 'pass')} passed, ${failed} failed, ${count(null, 'skip')} skipped in ${secs}s`);
results.filter((r) => r.status === 'fail').forEach((r) => console.log(`FAIL ${r.suite} ${r.name}\n     ${r.msg || ''}`));

if (!args.has('--no-record')) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace(/\d{3}Z$/, 'Z');
  const dir = join(root, 'tests', 'results', stamp);
  mkdirSync(dir, { recursive: true });
  const commit = run('git', ['rev-parse', '--short', 'HEAD'], root).out.trim();
  const env = { when_utc: new Date().toISOString(), commit, node: process.version, go: run('go', ['env', 'GOVERSION'], root).out.trim(), runner: process.env.GITHUB_ACTIONS ? 'GitHub Actions' : process.platform };
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ env, results }, null, 2));
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  let md = `# CareerForge test run — ${env.when_utc}\n\n| | |\n|---|---|\n| Commit | \`${commit}\` |\n| Go | ${env.go} |\n| Node | ${env.node} |\n| Runner | ${env.runner} |\n`;
  md += `| Result | **${count(null, 'pass')}/${results.length} passed**, ${failed} failed, ${count(null, 'skip')} skipped |\n| Duration | ${secs}s |\n\n`;
  md += '| Suite | Passed | Failed | Skipped |\n|---|---:|---:|---:|\n';
  for (const s of ['go', 'engine', 'e2e']) md += `| ${s} | ${count(s, 'pass')} | ${count(s, 'fail')} | ${count(s, 'skip')} |\n`;
  if (count('go', 'skip')) md += '\n> Skipped Go tests need the SQLite driver (`modernc.org/sqlite`); they always run in CI.\n';
  for (const s of ['go', 'engine', 'e2e']) {
    md += `\n## ${s}\n\n| Status | Test | ms |\n|---|---|---:|\n`;
    for (const r of results.filter((x) => x.suite === s)) {
      md += `| ${{ pass: '✅', fail: '❌', skip: '⏭️' }[r.status]} | ${esc(r.name)}${r.msg ? `<br>\`${esc(r.msg)}\`` : ''} | ${r.ms} |\n`;
    }
  }
  writeFileSync(join(dir, 'summary.md'), md);
  writeFileSync(join(root, 'tests', 'results', 'LATEST.md'), md);
  console.log(`Recorded: tests/results/${stamp}/`);
}
process.exit(failed ? 1 : 0);
