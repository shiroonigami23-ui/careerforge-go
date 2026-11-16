import { defineConfig } from '@playwright/test';

// E2E_BASE_URL points the suite at a running Go server (CI does this);
// otherwise Vite serves the app and it runs on the in-browser engine, like the phone apps.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: external || 'http://127.0.0.1:5173',
    headless: true,
    // CI uses Playwright's own Chromium; set PW_CHROMIUM_PATH to use an installed Chrome instead.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  webServer: external ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    port: 5173,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
