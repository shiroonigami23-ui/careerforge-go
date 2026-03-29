import { test, expect } from '@playwright/test';

test('black smoke: app shell is visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'CareerForge' }).first()).toBeVisible();
  await expect(page.getByText('Upload Limits & Supported Types')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible();
});

test('opens JD modal from main UI', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside.side-nav button', { hasText: 'Resume Lab' }).click();
  await page.getByRole('button', { name: /Add Job Description/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
