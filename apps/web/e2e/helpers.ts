import { expect, type Page } from '@playwright/test';

export const PASSPHRASE = 'correct-horse-battery';

/**
 * Usernames must be unique per run. The database is shared across Playwright
 * projects, workers and retries, so a hardcoded name makes the second run fail
 * with USERNAME_TAKEN.
 *
 * Must satisfy the server schema: /^[a-zA-Z0-9_-]+$/, 3-32 chars.
 */
export function uniqueUsername(prefix: string) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${rand}`.slice(0, 32);
}

/**
 * Note on selectors: the passphrase fields are `type="password"`, and password
 * inputs have no implicit ARIA role. `getByRole('textbox')` will never match
 * them — use `getByLabel`.
 */
export async function register(
  page: Page,
  username: string,
  passphrase = PASSPHRASE,
) {
  await page.goto('/');

  // The tab and the submit button both contain "register" — anchor the tab.
  await page.getByRole('button', { name: 'register', exact: true }).click();

  await page.getByLabel('username').fill(username);
  await page.getByLabel(/^passphrase$/).fill(passphrase);
  await page.getByLabel(/^confirm passphrase$/).fill(passphrase);

  await page
    .getByRole('button', { name: /generate keys \+ register/i })
    .click();

  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByText(/select a conversation to begin/i)).toBeVisible();
}

/**
 * Sidebar entries render initials alongside the username, so the accessible
 * name is "AB alice_..." — match on a substring rather than exact text.
 */
export function contact(page: Page, username: string) {
  return page.getByRole('button', { name: new RegExp(username) });
}

export async function openThreadWith(page: Page, username: string) {
  await contact(page, username).click();
}

export async function sendMessage(page: Page, text: string) {
  await page.getByPlaceholder('Write a message...').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}
