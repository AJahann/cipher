import { test, expect } from './fixtures';
import { PASSPHRASE } from './support/auth-paths';

test('drafts do not follow the user into another conversation', async ({
  alicePage,
  bobUsername,
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const charlie = `charlie-${Date.now()}`;
    await page.goto('/');
    await page.getByRole('button', { name: 'register', exact: true }).click();
    await page.getByLabel('username', { exact: true }).fill(charlie);
    await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
    await page
      .getByLabel('confirm passphrase', { exact: true })
      .fill(PASSPHRASE);
    await page
      .getByRole('button', { name: 'generate keys + register' })
      .click();
    await page.waitForURL('**/chat');
    await alicePage
      .getByRole('button', { name: bobUsername, exact: true })
      .click();
    await alicePage
      .getByRole('textbox')
      .fill('Private draft for Bob, not Charlie');
    alicePage.once('dialog', (dialog) => dialog.accept());
    await alicePage.getByRole('button', { name: charlie, exact: true }).click();
    await expect(
      alicePage.getByRole('heading', { name: charlie, exact: true }),
    ).toBeVisible();
    await expect(alicePage.getByRole('textbox')).toHaveValue('');
  } finally {
    await context.close();
  }
});

test('sign out removes keys and rejects the old authenticated cookie', async ({
  browser,
  aliceUsername,
}) => {
  // Never revoke the setup session reused by other test fixtures.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('username', { exact: true }).fill(aliceUsername);
    await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
    await page.getByRole('button', { name: 'authenticate' }).click();
    await page.waitForURL('**/chat');
    const session = (await context.cookies()).find(
      (cookie) => cookie.name === 'sessionId',
    );
    expect(session).toBeDefined();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(
      await page.evaluate(() => localStorage.getItem('e2ee:wrappedPrivateKey')),
    ).toBeNull();
    expect(
      await page.evaluate(() => localStorage.getItem('e2e_public_key')),
    ).toBeNull();
    const response = await page.request.get('http://localhost:3001/auth/me', {
      headers: { cookie: `sessionId=${session!.value}` },
    });
    expect(response.status()).toBe(401);
  } finally {
    await context.close();
  }
});
