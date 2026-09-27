// oxlint-disable no-await-in-loop
import fs from 'node:fs';

import { test as setup, type Page } from '@playwright/test';

import {
  PASSPHRASE,
  AUTH_DIR,
  USERS_FILE,
  storageStateFor,
} from './support/auth-paths';

async function register(page: Page, username: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'register' }).click();
  await page.getByLabel('username', { exact: true }).fill(username);
  await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('confirm passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'generate keys + register' }).click();
  await page.waitForURL('**/chat');
}

setup('authenticate alice and bob', async ({ browser }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const ts = Date.now();
  const users: Record<'alice' | 'bob', string> = {
    alice: `alice-${ts}`,
    bob: `bob-${ts}`,
  };

  for (const role of ['alice', 'bob'] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await register(page, users[role]);
    await ctx.storageState({ path: storageStateFor(role) });
    await ctx.close();
  }

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
});
