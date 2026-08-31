import { test, expect } from '@playwright/test';

test('authenticates and shows the empty inbox', async ({ page }) => {
  await page.goto('http://localhost:3000/');

  await page.getByRole('textbox', { name: /username/i }).fill('ashkan');
  await page.getByRole('textbox', { name: /passphrase/i }).fill('password');
  await page.getByRole('button', { name: /authenticate/i }).click();

  await expect(page.getByText(/select a conversation to begin/i)).toBeVisible();
});
