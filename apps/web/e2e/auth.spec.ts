import { test, expect, type Page } from '@playwright/test';

test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Chromium-only spec — Day 6 will add cross-browser coverage',
);

const PASSPHRASE = 's3cr3t-pass';
async function register(page: Page, username: string): Promise<void> {
  await page.goto('/');

  await page.getByRole('textbox', { name: /username/i }).fill('ashkan');
  await page.getByRole('textbox', { name: /passphrase/i }).fill('password');
  await page.getByRole('button', { name: /authenticate/i }).click();

  await expect(page.getByText(/select a conversation to begin/i)).toBeVisible();
});
