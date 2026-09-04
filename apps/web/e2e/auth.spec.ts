import { test, expect, type Page } from '@playwright/test';

const PASSPHRASE = 's3cr3t-pass';
async function register(page: Page, username: string): Promise<void> {
  await page.goto('/');

  await page.getByRole('button', { name: 'register' }).click();

  await page.getByLabel('username', { exact: true }).fill(username);
  await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('confirm passphrase', { exact: true }).fill(PASSPHRASE);

  await page.getByRole('button', { name: 'generate keys + register' }).click();

  await page.waitForURL('**/chat');
}

test('register → open conversation → send → receive', async ({
  browser,
  baseURL,
}) => {
  const ts = Date.now();
  const aliceUsername = `alice-${ts}`;
  const bobUsername = `bob-${ts}`;

  const contextOptions = { baseURL: baseURL ?? 'http://localhost:3000' };
  const aliceCtx = await browser.newContext(contextOptions);
  const bobCtx = await browser.newContext(contextOptions);

  const alicePage = await aliceCtx.newPage();
  const bobPage = await bobCtx.newPage();

  try {
    await register(bobPage, bobUsername);
    await register(alicePage, aliceUsername);

    await alicePage.getByRole('button', { name: bobUsername }).click();

    await alicePage.getByRole('textbox').fill('hello from alice');
    await alicePage.getByRole('button', { name: 'Send message' }).click();

    await expect(
      alicePage.getByRole('paragraph').filter({ hasText: 'hello from alice' }),
    ).toBeVisible();

    await bobPage.getByRole('button', { name: aliceUsername }).click();

    await expect(
      bobPage.getByRole('paragraph').filter({ hasText: 'hello from alice' }),
    ).toBeVisible();
  } finally {
    await aliceCtx.close();
    await bobCtx.close();
  }
});
