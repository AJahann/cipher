import fs from 'node:fs';

import { test as setup, type Page } from '@playwright/test';

import { PASSPHRASE, AUTH_DIR, USERS_FILE, storageStateFor } from './support/auth-paths';

// The one place register() lives now. It runs once, in the `setup` project,
// before any browser project (see `dependencies: ['setup']` in the config).
async function register(page: Page, username: string): Promise<void> {
  await page.goto('/');
  // In login mode the only button named exactly "register" is the tab switcher.
  await page.getByRole('button', { name: 'register' }).click();
  await page.getByLabel('username', { exact: true }).fill(username);
  await page.getByLabel('passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('confirm passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'generate keys + register' }).click();
  // waitForURL is a happens-before edge: navigation to /chat means register
  // resolved and the session cookie + wrapped key are persisted.
  await page.waitForURL('**/chat');
}

setup('authenticate alice and bob', async ({ browser }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // Unique per run => no collision with rows left in the dev DB by a prior run.
  // That "passes once, fails on rerun" flake is exactly what Day 6 is about.
  const ts = Date.now();
  const users: Record<'alice' | 'bob', string> = {
    alice: `alice-${ts}`,
    bob: `bob-${ts}`,
  };

  for (const role of ['alice', 'bob'] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await register(page, users[role]);
    // storageState captures cookies + localStorage (the WRAPPED private key).
    // It does NOT capture the decrypted session key held in module RAM.
    await ctx.storageState({ path: storageStateFor(role) });
    await ctx.close();
  }

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
});
