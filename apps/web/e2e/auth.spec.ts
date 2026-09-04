import { test, expect } from '@playwright/test';
import { PASSPHRASE, register, uniqueUsername } from './helpers';

test('registers and shows the empty inbox', async ({ page }) => {
  await register(page, uniqueUsername('auth'));

  await expect(page.getByText(/select a conversation to begin/i)).toBeVisible();
});

test('authenticates an existing account', async ({ page, context }) => {
  const username = uniqueUsername('auth');

  await register(page, username);

  // Drop the session and the unwrapped key, then sign back in.
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  await page.goto('/');
  await page.getByLabel('username').fill(username);
  await page.getByLabel(/^passphrase$/).fill(PASSPHRASE);
  await page.getByRole('button', { name: /authenticate/i }).click();

  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByText(/select a conversation to begin/i)).toBeVisible();
});
