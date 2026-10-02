import fs from 'node:fs';

import { AxeBuilder } from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

import { test, expect } from './fixtures';
import { PASSPHRASE, storageStateFor } from './support/auth-paths';

// Every route × SessionGate state is scanned; a state only counts once it is
// actually reached (asserted before scanning). The "ready" state cannot come
// from storageState alone because the private key lives only in memory, so the
// fixtures unlock first.

const BLOCKING = new Set(['critical', 'serious']);
const MIXED = 'سلام! این پیام با React 19 و Next.js تست شد.';

async function expectNoBlockingViolations(
  page: Page,
  state: string,
  testInfo: TestInfo,
) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  await testInfo.attach(`axe · ${state}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });

  const blocking = results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      state,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  expect(blocking, `${state}: critical/serious axe violations`).toEqual([]);
}

test.describe('axe: route × SessionGate state', () => {
  test('/chat — checking (prerendered loading state)', async ({
    page,
  }, testInfo) => {
    // Block app JS so the pre-hydration AuthGuard/SessionGate state holds.
    await page.route('**/_next/static/**/*.js', (route) => route.abort());
    await page.goto('/chat');
    await expect(
      page.getByRole('heading', { level: 1, name: 'loading...' }),
    ).toBeVisible();
    await expectNoBlockingViolations(page, '/chat checking', testInfo);
  });

  test('/ — login, validation, failure, register', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'authenticate' }),
    ).toBeVisible();
    await expectNoBlockingViolations(page, '/ login', testInfo);

    await page.getByRole('button', { name: 'authenticate' }).click();
    await expect(page.getByText('username is required')).toBeVisible();
    await expectNoBlockingViolations(page, '/ login · validation', testInfo);

    await page
      .getByLabel('username', { exact: true })
      .fill(`nobody-${Date.now()}`);
    await page.getByLabel('passphrase', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'authenticate' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expectNoBlockingViolations(page, '/ login · auth failed', testInfo);

    await page.getByRole('button', { name: 'register' }).click();
    await expect(
      page.getByLabel('confirm passphrase', { exact: true }),
    ).toBeVisible();
    await expectNoBlockingViolations(page, '/ register', testInfo);
  });

  test('/chat — need-login redirects to an accessible sign-in', async ({
    browser,
  }, testInfo) => {
    const { cookies } = JSON.parse(
      fs.readFileSync(storageStateFor('alice'), 'utf8'),
    );
    // Session cookie present, wrapped key absent → SessionGate "need-login".
    const context = await browser.newContext({
      storageState: { cookies, origins: [] },
    });
    const page = await context.newPage();
    await page.goto('/chat');
    await page.waitForURL((url) => url.pathname === '/');
    await expect(
      page.getByRole('button', { name: 'authenticate' }),
    ).toBeVisible();
    await expectNoBlockingViolations(page, '/chat need-login', testInfo);
    await context.close();
  });

  test('/chat — need-unlock, including a wrong passphrase', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      storageState: storageStateFor('alice'),
    });
    const page = await context.newPage();
    await page.goto('/chat');
    await expect(
      page.getByRole('heading', { name: 'Unlock session' }),
    ).toBeVisible();
    await expectNoBlockingViolations(page, '/chat need-unlock', testInfo);

    await page
      .getByLabel('passphrase', { exact: true })
      .fill(`${PASSPHRASE}-nope`);
    await page.getByRole('button', { name: 'unlock', exact: true }).click();
    await expect(
      page.getByText('wrong passphrase or damaged key'),
    ).toBeVisible();
    await expectNoBlockingViolations(
      page,
      '/chat need-unlock · error',
      testInfo,
    );
    await context.close();
  });

  test('/chat — ready, with a mixed-direction conversation', async ({
    alicePage: page,
    bobUsername,
  }, testInfo) => {
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '// select a conversation to begin',
      }),
    ).toBeVisible();
    await expectNoBlockingViolations(page, '/chat ready · empty', testInfo);

    await page.getByRole('button', { name: bobUsername, exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: bobUsername }),
    ).toBeVisible();

    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill(MIXED);
    await expect(composer).toHaveJSProperty('dir', 'auto');
    expect(await composer.evaluate((el) => el.matches(':dir(rtl)'))).toBe(true);
    await composer.press('Enter');

    const message = page
      .getByRole('log', { name: 'Messages' })
      .getByText(MIXED);
    await expect(message).toBeVisible();
    expect(await message.evaluate((el) => el.matches(':dir(rtl)'))).toBe(true);
    await expectNoBlockingViolations(
      page,
      '/chat ready · conversation',
      testInfo,
    );

    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeVisible();
    await expectNoBlockingViolations(
      page,
      '/chat ready · shortcuts dialog',
      testInfo,
    );
  });
});
