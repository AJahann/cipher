import fs from 'node:fs';

import {
  test as base,
  expect,
  type Browser,
  type Page,
} from '@playwright/test';

import {
  PASSPHRASE,
  USERS_FILE,
  storageStateFor,
  type Role,
} from './support/auth-paths';

interface Fixtures {
  aliceUsername: string;
  bobUsername: string;
  alicePage: Page;
  bobPage: Page;
}

function readUsers(): { alice: string; bob: string } {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

async function withUnlockedPage(
  browser: Browser,
  role: Role,
  pageUse: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    storageState: storageStateFor(role),
  });
  const page = await context.newPage();

  await page.goto('/chat');

  await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'unlock', exact: true }).click();

  await expect(page.getByText('conversations')).toBeVisible();

  await pageUse(page);
  await context.close();
}

export const test = base.extend<Fixtures>({
  aliceUsername: async (_fixtures, pageUse) => {
    await pageUse(readUsers().alice);
  },
  bobUsername: async (_fixtures, pageUse) => {
    await pageUse(readUsers().bob);
  },
  alicePage: async ({ browser }, use) => {
    await withUnlockedPage(browser, 'alice', use);
  },
  bobPage: async ({ browser }, use) => {
    await withUnlockedPage(browser, 'bob', use);
  },
});

export { expect };
