import fs from 'node:fs';
import path from 'node:path';
import {
  test as base,
  expect,
  type Browser,
  type Page,
} from '@playwright/test';
import {
  PASSPHRASE,
  AUTH_DIR,
  createAuthDirectory,
} from './support/auth-paths';
import { provisionUsers, type AuthUsers } from './support/provision';

interface WorkerAuth {
  directory: string;
  users: AuthUsers;
}
interface Fixtures {
  aliceUsername: string;
  bobUsername: string;
  aliceState: string;
  alicePage: Page;
  bobPage: Page;
}

async function withUnlockedPage(
  browser: Browser,
  state: string,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    await page.goto('/chat');
    await expect(
      page.getByRole('heading', { name: 'Unlock session' }),
    ).toBeVisible();
    await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
    await page.getByRole('button', { name: 'unlock', exact: true }).click();
    await expect(page.getByText('conversations')).toBeVisible();
    await use(page);
  } finally {
    await context.close();
  }
}

export const test = base.extend<Fixtures, { workerAuth: WorkerAuth }>({
  workerAuth: [
    async ({}, use, workerInfo) => {
      // Keep credentials outside uploaded test-results. mkdtemp isolates projects,
      // simultaneous runs and worker restarts, including after a failed test.
      const directory = createAuthDirectory(
        AUTH_DIR,
        workerInfo.project.name,
        workerInfo.workerIndex,
      );
      try {
        const users = await provisionUsers(directory);
        await use({ directory, users });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
  aliceUsername: async ({ workerAuth }, use) => {
    await use(workerAuth.users.alice);
  },
  bobUsername: async ({ workerAuth }, use) => {
    await use(workerAuth.users.bob);
  },
  aliceState: async ({ workerAuth }, use) => {
    await use(path.join(workerAuth.directory, 'alice.json'));
  },
  alicePage: async ({ browser, workerAuth }, use) => {
    await withUnlockedPage(
      browser,
      path.join(workerAuth.directory, 'alice.json'),
      use,
    );
  },
  bobPage: async ({ browser, workerAuth }, use) => {
    await withUnlockedPage(
      browser,
      path.join(workerAuth.directory, 'bob.json'),
      use,
    );
  },
});
export { expect };
