import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.PERF_BASE_URL || 'http://127.0.0.1:8000';
const RUNS = Number(process.env.PERF_RUNS || 15);

async function hitHealth() {
  const start = performance.now();
  const response = await fetch(`${BASE_URL}/`);
  const body = await response.text();
  const elapsed = performance.now() - start;
  return { ok: response.ok, status: response.status, elapsed, body };
}

async function run() {
  const durations = [];

  for (let i = 0; i < RUNS; i += 1) {
    const result = await hitHealth();
    if (!result.ok) {
      throw new Error(`Health check failed with status ${result.status}: ${result.body}`);
    }
    durations.push(result.elapsed);
  }

  durations.sort((a, b) => a - b);
  const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const p95 = durations[Math.floor(durations.length * 0.95) - 1] || durations[durations.length - 1];

  console.log(`Performance smoke (${RUNS} runs)`);
  console.log(`avg_ms=${avg.toFixed(2)}`);
  console.log(`p95_ms=${p95.toFixed(2)}`);

  if (p95 > 500) {
    throw new Error(`p95 too high: ${p95.toFixed(2)}ms`);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
