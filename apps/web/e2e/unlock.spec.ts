import { test, expect } from '@playwright/test';

import { PASSPHRASE, storageStateFor } from './support/auth-paths';

test('storageState alone lands on the unlock gate; passphrase restores the session', async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: storageStateFor('alice'),
  });
  const page = await context.newPage();

  await page.goto('/chat');

  await expect(
    page.getByRole('heading', { name: 'Unlock session' }),
  ).toBeVisible();

  await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'unlock', exact: true }).click();

  await expect(page.getByText('conversations')).toBeVisible();

  await context.close();
});
