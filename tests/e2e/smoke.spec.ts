import { test, expect } from '@playwright/test';

test('homepage renders WAYFOUND brand', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=WAYFOUND').first()).toBeVisible({ timeout: 30_000 });
});
