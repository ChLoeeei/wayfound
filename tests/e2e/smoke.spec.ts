import { test, expect } from '@playwright/test';

test('homepage renders the Wayfound top bar and the planning form', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('language-toggle')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('planning-form')).toBeVisible();
});

test('switching the language re-renders the form in Chinese', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('lang-zh').click();
  await expect(page.getByTestId('submit-plan')).toHaveText('生成行程');
});
