import fs from 'node:fs';

import { test as base, expect, type Browser, type Page } from '@playwright/test';

import { PASSPHRASE, USERS_FILE, storageStateFor, type Role } from './support/auth-paths';

interface Fixtures {
  aliceUsername: string;
  bobUsername: string;
  alicePage: Page;
  bobPage: Page;
}

// Read at fixture-run time (after the setup project), never at import time.
function readUsers(): { alice: string; bob: string } {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

async function withUnlockedPage(
  browser: Browser,
  role: Role,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ storageState: storageStateFor(role) });
  const page = await context.newPage();

  await page.goto('/chat');

  // storageState restored the wrapped key (localStorage) + session cookie, so
  // AuthGuard passes -- but the decrypted key is not in RAM yet, so SessionGate
  // renders UnlockForm. Re-derive the session key into memory:
  await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'unlock', exact: true }).click();

  // Web-first assertion, not a sleep: this is the happens-before edge that says
  // "keys are in RAM and the conversation list has rendered." Every test that
  // consumes this fixture starts causally after that fact.
  await expect(page.getByText('conversations')).toBeVisible();

  await use(page);
  await context.close();
}

export const test = base.extend<Fixtures>({
  aliceUsername: async ({}, use) => {
    await use(readUsers().alice);
  },
  bobUsername: async ({}, use) => {
    await use(readUsers().bob);
  },
  alicePage: async ({ browser }, use) => {
    await withUnlockedPage(browser, 'alice', use);
  },
  bobPage: async ({ browser }, use) => {
    await withUnlockedPage(browser, 'bob', use);
  },
});

export { expect };
