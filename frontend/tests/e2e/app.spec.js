import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Black-box UI tests. With no Go server behind Vite the app uses the on-device engine,
// exactly like the Android/iOS builds.

async function waitForSplash(page) {
  await expect(page.locator('#boot-splash')).toHaveCount(0, { timeout: 8000 }); // animated splash fades after >= 2 s
}

async function enterWorkspace(page) {
  await page.goto('/');
  await waitForSplash(page);
  await page.getByText('Enter Workspace').click();
}

const RESUME = 'Aryan Singh\naryan@example.com\n+91 98765 43210\nlinkedin.com/in/aryan\n\nSKILLS\nPython Docker Kubernetes Go\n\nEXPERIENCE\nLed a migration and built 3 services, improved latency by 40%\n\nEDUCATION\nB.Tech CSE 2027\n';

async function analyze(page) {
  const dir = mkdtempSync(join(tmpdir(), 'cf-e2e-'));
  const cv = join(dir, 'cv.txt');
  writeFileSync(cv, RESUME);
  await page.goto('/');
  await waitForSplash(page);
  await page.getByRole('button', { name: /Analyze a résumé/ }).click();
  await page.locator('#resume-upload').setInputFiles(cv);
  await expect(page.getByText(/cv\.txt/)).toBeVisible();
  await page.getByLabel('Job description text').fill('We need Python, Docker and Kubernetes. Terraform is a plus.');
  await page.getByRole('button', { name: 'Analyze fit' }).click();
  await expect(page.getByText('Insights ready')).toBeVisible({ timeout: 20000 });
}

test('boot splash shows the CareerForge name and emblem for at least 2 s, then goes away', async ({ page }) => {
  // Record when the splash element is removed, relative to when the page started.
  await page.addInitScript(() => {
    new MutationObserver((_, obs) => {
      if (window.__cfBootStart && !document.getElementById('boot-splash')) {
        window.__cfSplashGoneAfter = Date.now() - window.__cfBootStart;
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/', { waitUntil: 'commit' });
  const splash = page.locator('#boot-splash');
  await expect(splash.getByText('CareerForge')).toBeAttached();
  await expect(splash.locator('img')).toHaveAttribute('src', '/emblem.png');
  await expect(splash).toHaveCount(0, { timeout: 8000 });
  const shownMs = await page.evaluate(() => window.__cfSplashGoneAfter);
  expect(shownMs).toBeGreaterThanOrEqual(2000);
});

test('landing page shows the sample report and leads into the workspace', async ({ page }) => {
  await page.goto('/');
  await waitForSplash(page);
  await expect(page.getByLabel('Sample report')).toBeVisible();
  await page.getByText('Enter Workspace').click();
  for (const name of ['Dashboard', 'Analyze', 'Direct chat', 'Profile', 'Settings', 'Help']) {
    await expect(page.locator('.side-nav nav button', { hasText: name })).toBeVisible();
  }
});

test('analyze: fit score, keyword map, checklist, assistant', async ({ page }) => {
  await analyze(page);
  const dial = page.locator('.report figure.fit-dial');
  const label = await dial.getAttribute('aria-label');
  const score = Number(label.match(/(\d+) out of 100/)[1]);
  expect(score).toBeGreaterThan(0);
  expect(score).toBeLessThanOrEqual(100);
  await expect(page.locator('.report .chip.match', { hasText: 'python' })).toBeVisible();
  await expect(page.locator('.report .chip.gap', { hasText: 'terraform' })).toBeVisible();

  const first = page.locator('.checklist input').first();
  await first.check();
  await expect(page.getByText(/1 of \d+ done/)).toBeVisible();

  await page.getByRole('button', { name: 'What are my top 5 missing skills?' }).click();
  await expect(page.locator('.msg.assistant')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('.msg.assistant .msg-bubble')).not.toHaveText('…', { timeout: 15000 });
});

test('report downloads as Markdown', async ({ page }) => {
  await analyze(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^careerforge-report-.*\.md$/);
});

test('dashboard lists the analysis and reopens it', async ({ page }) => {
  await analyze(page);
  await page.locator('.side-nav nav button', { hasText: 'Dashboard' }).click();
  const item = page.locator('.history li button').first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByText('Insights ready')).toBeVisible({ timeout: 10000 });
});

test('quick navigation opens with Ctrl+K', async ({ page }) => {
  await enterWorkspace(page);
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search', { exact: true }).fill('help');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
});

test('mobile layout uses the bottom navigation', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await enterWorkspace(page);
  await expect(page.locator('.side-nav')).toBeHidden();
  await page.locator('.bottom-nav button', { hasText: 'Analyze' }).click();
  await expect(page.getByRole('heading', { name: 'Analyze', level: 1 })).toBeVisible();
  await page.close();
});

// ---------- accounts, profile, settings, direct chat ----------

test('account: create, sign out, sign back in', async ({ page }) => {
  const email = `e2e${Date.now()}@example.com`;
  await page.goto('/');
  await waitForSplash(page);
  await page.getByRole('button', { name: 'Create an account' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Asha Rao');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Password').fill('hunter22');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.account-text strong')).toHaveText('Asha Rao');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: /Analyze a résumé/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Password').fill('wrong-pass');
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(dialog.getByText('invalid email or password')).toBeVisible();
  await dialog.getByLabel('Password').fill('hunter22');
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.account-text strong')).toHaveText('Asha Rao');
});

test('profile: save details and photo, they survive a reload, lookup by user ID works', async ({ page }) => {
  await enterWorkspace(page);
  await page.locator('.side-nav nav button', { hasText: 'Profile' }).click();
  await page.getByLabel('Name').fill('Asha Rao');
  await page.getByLabel('Headline').fill('Backend engineer, Go');
  await page.getByLabel('About').fill('Looking for platform roles.');
  await page.locator('input[type=file]').setInputFiles(new URL('./avatar.png', import.meta.url).pathname);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await expect(page.locator('img.avatar')).toBeVisible();
  const userId = await page.locator('.id-row code').innerText();

  await page.reload();
  await waitForSplash(page);
  await page.getByText('Enter Workspace').click();
  await page.locator('.side-nav nav button', { hasText: 'Profile' }).click();
  await expect(page.getByLabel('Headline')).toHaveValue('Backend engineer, Go');
  await expect(page.locator('img.avatar')).toBeVisible();

  await page.getByLabel('User ID', { exact: true }).fill(userId);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.visited strong')).toHaveText('Asha Rao');

  await page.locator('.side-nav nav button', { hasText: 'Dashboard' }).click();
  await expect(page.locator('.stat', { hasText: 'Profile' }).locator('strong')).toHaveText('80%');
});

test('settings: AI key and model are saved on the device; theme persists', async ({ page }) => {
  await enterWorkspace(page);
  await page.locator('.side-nav nav button', { hasText: 'Settings' }).click();
  await page.getByLabel('Gemini API key').fill('AIza-test-key');
  await page.getByLabel('Model').fill('gemini-2.5-flash');
  await page.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(page.getByText('AI settings saved on this device.')).toBeVisible();
  await page.getByRole('tab', { name: 'Dark' }).click();
  await page.reload();
  await waitForSplash(page);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.getByText('Enter Workspace').click();
  await page.locator('.side-nav nav button', { hasText: 'Settings' }).click();
  await expect(page.getByLabel('Gemini API key')).toHaveValue('AIza-test-key');
  await expect(page.getByLabel('Model')).toHaveValue('gemini-2.5-flash');
});

test('direct chat: two devices connect and exchange messages', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  for (const p of [a, b]) {
    await enterWorkspace(p);
    await p.locator('.side-nav nav button', { hasText: 'Direct chat' }).click();
  }
  const code = (p) => p.locator('textarea.code-box[readonly]');
  await a.getByRole('button', { name: 'Create invite' }).click();
  await expect(code(a)).not.toHaveValue('', { timeout: 10000 });
  await a.waitForTimeout(1500); // let ICE gathering finish so the code is complete
  await b.getByLabel('Their code (paste here)').fill(await code(a).inputValue());
  await b.getByRole('button', { name: 'Create reply from invite' }).click();
  await expect(code(b)).not.toHaveValue('', { timeout: 10000 });
  await b.waitForTimeout(1500);
  await a.getByLabel('Their code (paste here)').fill(await code(b).inputValue());
  await a.getByRole('button', { name: 'Connect with reply' }).click();
  await expect(a.locator('.engine-badge', { hasText: 'Connected' })).toBeVisible({ timeout: 15000 });
  await expect(b.locator('.engine-badge', { hasText: 'Connected' })).toBeVisible({ timeout: 15000 });
  await a.getByLabel('Message', { exact: true }).fill('Hello from A');
  await a.getByRole('button', { name: 'Send' }).click();
  await expect(b.locator('.msg-bubble', { hasText: 'Hello from A' })).toBeVisible();
  await b.getByLabel('Message', { exact: true }).fill('Hi A, B here');
  await b.getByRole('button', { name: 'Send' }).click();
  await expect(a.locator('.msg-bubble', { hasText: 'Hi A, B here' })).toBeVisible();
  await a.close();
  await b.close();
});
