import { test, expect } from './fixtures';

test('disabled configuration leaves no GitHub sign-in UI', async ({ page }) => {
  await page.route('**/auth/config', (route) =>
    route.fulfill({ json: { githubEnabled: false } }),
  );
  const config = page.waitForResponse('**/auth/config');
  await page.goto('/');
  await config;
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
  await expect(page.getByText(/GitHub/)).toHaveCount(0);
});

test('enabled configuration exposes the existing GitHub sign-in navigation', async ({
  page,
}) => {
  await page.route('**/auth/config', (route) =>
    route.fulfill({ json: { githubEnabled: true } }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Sign in with GitHub' }),
  ).toHaveAttribute('href', /\/auth\/github$/);
});

test('chat respects the global switch and saved link status after reload', async ({
  browser,
  aliceState,
}) => {
  const context = await browser.newContext({
    storageState: aliceState,
  });
  const page = await context.newPage();
  let githubEnabled = false;
  let linked = false;
  let statusRequests = 0;
  await page.route('**/auth/config', (route) =>
    route.fulfill({ json: { githubEnabled } }),
  );
  await page.route('**/auth/github/status', (route) => {
    statusRequests += 1;
    return route.fulfill({ json: { linked } });
  });
  const config = page.waitForResponse('**/auth/config');
  await page.goto('/chat');
  await config;
  await expect(
    page.getByRole('heading', { name: 'Unlock session' }),
  ).toBeVisible();
  await expect(page.getByText(/GitHub/)).toHaveCount(0);
  expect(statusRequests).toBe(0);

  githubEnabled = true;
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Link GitHub to this Cipher account' }),
  ).toBeVisible();

  linked = true;
  const status = page.waitForResponse('**/auth/github/status');
  await page.reload();
  await status;
  await expect(page.getByText(/GitHub/)).toHaveCount(0);
  await context.close();
});
