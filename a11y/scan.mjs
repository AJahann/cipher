// Full axe scan of every route × SessionGate state.
// Usage: node a11y/scan.mjs <label>   (writes a11y/results/axe-<label>.json + screenshots)
// Requires the API and web app running (PLAYWRIGHT_BASE_URL, default http://localhost:3000).
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const label = process.argv[2] ?? 'run';
const OUT = path.resolve('a11y/results');
fs.mkdirSync(OUT, { recursive: true });
const PASS = 's3cr3t-pass';
export const MIXED = 'سلام! این پیام با React 19 و Next.js تست شد.';
export const MIXED_REPLY = 'Deploy شد؟ yes, deploy کردم!';

const results = [];

async function scan(page, route, state) {
  await page.waitForTimeout(400);
  const r = await new AxeBuilder({ page })
    .withTags([
      'wcag2a',
      'wcag2aa',
      'wcag21a',
      'wcag21aa',
      'wcag22aa',
      'best-practice',
    ])
    .analyze();
  results.push({
    route,
    state,
    url: page.url(),
    violations: r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target.join(' '),
        html: n.html.slice(0, 160),
        summary: n.failureSummary?.split('\n').slice(0, 3).join(' '),
      })),
    })),
  });
  console.log(
    `${route} [${state}]: ${r.violations.map((v) => `${v.id}(${v.impact},${v.nodes.length})`).join(', ') || 'clean'}`,
  );
}

async function register(browser, username) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'register' }).click();
  await page.getByLabel('username', { exact: true }).fill(username);
  await page.getByLabel('passphrase', { exact: true }).fill(PASS);
  await page.getByLabel('confirm passphrase', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: 'generate keys + register' }).click();
  await page.waitForURL('**/chat');
  await expect(
    page.getByRole('complementary', { name: 'Conversations' }),
  ).toBeVisible();
  return { ctx, page };
}

async function openConversation(page, name) {
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
}

async function send(page, text) {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.keyboard.press('Enter');
  await expect(page.getByText(text).first()).toBeVisible();
}

const browser = await chromium.launch();
const ts = Date.now();
const alice = `alice-${ts}`;
const bob = `bob-${ts}`;

// 0. "checking": the prerendered /chat HTML (AuthGuard loading / SessionGate
// checking) before hydration. App JS is blocked so the transient state holds.
{
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.route('**/_next/static/**/*.js', (r) => r.abort());
  await page.goto('/chat');
  await expect(page.getByText('loading...')).toBeVisible();
  await scan(page, '/chat', 'checking (prerendered loading, pre-hydration)');
  await ctx.close();
}

// 1. "/" anonymous: login, register, failed login.
{
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'authenticate' }),
  ).toBeVisible();
  await scan(page, '/', 'anonymous · login mode');
  await page.getByRole('button', { name: 'authenticate' }).click();
  await scan(page, '/', 'anonymous · login validation errors');
  await page.getByLabel('username', { exact: true }).fill('nobody-' + ts);
  await page.getByLabel('passphrase', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'authenticate' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await scan(page, '/', 'anonymous · authentication failed');
  await page.getByRole('button', { name: 'register' }).click();
  await scan(page, '/', 'anonymous · register mode');
  // /chat without a session → AuthGuard redirects home.
  await page.goto('/chat');
  await page.waitForURL(BASE + '/');
  await scan(page, '/chat → /', 'no session (AuthGuard redirect)');
  await ctx.close();
}

// 2. Register both users.
const A = await register(browser, alice);
const B = await register(browser, bob);

// Reload so each user list includes the other; the reload drops the in-memory
// private key, so unlock (storageState/cookies alone never reach "ready").
async function unlock(page) {
  await page.reload();
  await page.getByLabel('passphrase', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: 'unlock', exact: true }).click();
  await expect(page.getByText('select a conversation to begin')).toBeVisible();
}
await unlock(A.page);
await unlock(B.page);

// 3. Ready state.
await scan(A.page, '/chat', 'ready · no conversation selected');
await openConversation(A.page, bob);
await scan(A.page, '/chat', 'ready · empty conversation');
await send(A.page, MIXED);
await openConversation(B.page, alice);
await send(B.page, MIXED_REPLY);
await expect(A.page.getByText(MIXED_REPLY)).toBeVisible();
await scan(A.page, '/chat', 'ready · conversation with messages');
await A.page.locator('#message-composer').fill(MIXED);
const bubble = A.page.getByText(MIXED, { exact: true }).first();
await A.page.screenshot({ path: path.join(OUT, `chat-${label}.png`) });
await A.page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
await expect(A.page.getByRole('dialog')).toBeVisible();
await scan(A.page, '/chat', 'ready · keyboard-shortcuts dialog open');
await A.page.keyboard.press('Escape');

// 4. need-unlock: session cookie + wrapped key, private key gone from memory.
const state = await A.ctx.storageState();
fs.writeFileSync(path.join(OUT, '.alice-state.json'), JSON.stringify(state));
{
  const ctx = await browser.newContext({ baseURL: BASE, storageState: state });
  const page = await ctx.newPage();
  await page.goto('/chat');
  await expect(
    page.getByRole('heading', { name: 'Unlock session' }),
  ).toBeVisible();
  await scan(page, '/chat', 'need-unlock');
  await page.getByLabel('passphrase', { exact: true }).fill('wrong-pass');
  await page.getByRole('button', { name: 'unlock', exact: true }).click();
  await expect(page.getByText('wrong passphrase or damaged key')).toBeVisible();
  await scan(page, '/chat', 'need-unlock · wrong passphrase');
  // Unlock, then scan the restored ready state (storageState alone is not enough).
  await page.getByLabel('passphrase', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: 'unlock', exact: true }).click();
  await expect(page.getByText('select a conversation to begin')).toBeVisible();
  await openConversation(page, bob);
  await expect(page.getByText(MIXED_REPLY)).toBeVisible();
  await scan(
    page,
    '/chat',
    'ready (after unlock) · conversation with messages',
  );
  await ctx.close();
}

// 5. need-login: valid session cookie, but no wrapped key in localStorage.
{
  const cookiesOnly = { cookies: state.cookies, origins: [] };
  const ctx = await browser.newContext({
    baseURL: BASE,
    storageState: cookiesOnly,
  });
  const page = await ctx.newPage();
  await page.goto('/chat');
  await page.waitForURL(BASE + '/');
  await expect(
    page.getByRole('button', { name: 'authenticate' }),
  ).toBeVisible();
  await scan(page, '/chat → /', 'need-login (SessionGate redirect)');
  await ctx.close();
}

fs.writeFileSync(
  path.join(OUT, `axe-${label}.json`),
  JSON.stringify(results, null, 2),
);
fs.writeFileSync(path.join(OUT, '.users.json'), JSON.stringify({ alice, bob }));
await A.ctx.close();
await B.ctx.close();
await browser.close();
