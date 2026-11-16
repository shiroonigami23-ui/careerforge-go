import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Black-box UI tests. With no Go server behind Vite the app uses the on-device engine,
// exactly like the Android/iOS builds.

async function enterWorkspace(page) {
  await page.goto('/');
  await expect(page.locator('#boot-splash')).toHaveCount(0, { timeout: 6000 }); // animated splash fades after >= 2 s
  await page.getByRole('button', { name: 'Enter Workspace' }).click();
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

test('landing page -> workspace with all sections', async ({ page }) => {
  await enterWorkspace(page);
  for (const name of ['Dashboard', 'Resume Lab', 'Direct Chat', 'Profile', 'Help']) {
    await expect(page.locator('aside.side-nav button', { hasText: name })).toBeVisible();
  }
});

test('JD modal opens and closes', async ({ page }) => {
  await enterWorkspace(page);
  await page.locator('aside.side-nav button', { hasText: 'Resume Lab' }).click();
  await page.getByRole('button', { name: /Add Job Description/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Upload & Analyze' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('upload resume + pasted JD -> quality insights -> assistant answers', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-e2e-'));
  const cv = join(dir, 'cv.txt');
  writeFileSync(cv, 'Aryan Singh\naryan@example.com\n+91 98765 43210\nlinkedin.com/in/aryan\n\nSKILLS\nPython Docker Kubernetes Go\n\nEXPERIENCE\nLed a migration and built 3 services, improved latency by 40%\n\nEDUCATION\nB.Tech CSE 2027\n');

  await enterWorkspace(page);
  await page.locator('aside.side-nav button', { hasText: 'Resume Lab' }).click();
  await page.locator('#resume-upload').setInputFiles(cv);
  await expect(page.getByText('cv.txt')).toBeVisible();
  await page.getByRole('button', { name: /Add Job Description/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('textarea').fill('We need Python, Docker and Kubernetes experience.');
  await dialog.getByRole('button', { name: 'Upload & Analyze' }).click();

  await expect(page.getByText('Insights ready')).toBeVisible({ timeout: 20000 });
  const score = page.locator('.quality-grid p', { hasText: 'Quality Score' });
  await expect(score).toContainText(/\d+%/);
  const pct = Number((await score.innerText()).match(/(\d+)%/)[1]);
  expect(pct).toBeGreaterThan(0);
  expect(pct).toBeLessThanOrEqual(100);
  await expect(page.locator('.quality-grid p', { hasText: 'Keyword Coverage' })).not.toContainText(/: 0%/);

  const before = await page.locator('.message-row.assistant').count();
  await page.locator('.chip-row .chip').first().click();
  await expect(page.locator('.message-row.assistant')).toHaveCount(before + 1, { timeout: 15000 });
});
