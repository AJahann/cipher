import { test, expect } from '@playwright/test';

import { PASSPHRASE, storageStateFor } from './support/auth-paths';

// This spec deliberately does NOT use the alicePage fixture (which unlocks for
// you). It uses storageState only, to prove the RAM-key vs wrapped-key gate.
test('storageState alone lands on the unlock gate; passphrase restores the session', async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: storageStateFor('alice') });
  const page = await context.newPage();

  await page.goto('/chat');

  // Wrapped private key is in localStorage and the session cookie is set, but
  // the decrypted key is not in RAM -> SessionGate shows the unlock screen.
  await expect(page.getByRole('heading', { name: 'Unlock session' })).toBeVisible();

  await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'unlock', exact: true }).click();

  // restoreSessionKeys() put the key in RAM -> gate opens to the list.
  await expect(page.getByText('conversations')).toBeVisible();

  await context.close();
});
