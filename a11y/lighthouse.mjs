// Lighthouse accessibility score per route × SessionGate state.
// Usage: node a11y/lighthouse.mjs <label>  (writes a11y/results/lighthouse-<label>.json)
// Needs a11y/results/.users.json from `node a11y/scan.mjs` (alice ↔ bob with messages).
// Navigation mode where the state is reachable by URL, snapshot mode for states
// that only exist in memory (the private key is never persisted, so "ready" is
// reached by logging in, not by restoring storage).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { snapshot, startFlow } from 'lighthouse';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const label = process.argv[2] ?? 'run';
const OUT = path.resolve('a11y/results');
const { alice, bob } = JSON.parse(
  fs.readFileSync(path.join(OUT, '.users.json'), 'utf8'),
);
const PASS = 's3cr3t-pass';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--window-size=1350,940'],
  defaultViewport: null,
});
const page = await browser.newPage();
const flow = await startFlow(page, {
  config: {
    extends: 'lighthouse:default',
    settings: {
      onlyCategories: ['accessibility'],
      formFactor: 'desktop',
      screenEmulation: { disabled: true },
      disableStorageReset: true,
    },
  },
});

const steps = [];
async function nav(url, route, state) {
  await flow.navigate(BASE + url, { name: `${route} — ${state}` });
  steps.push({ route, state, mode: 'navigation' });
}
async function snap(route, state) {
  await new Promise((r) => setTimeout(r, 500));
  await flow.snapshot({ name: `${route} — ${state}` });
  steps.push({ route, state, mode: 'snapshot' });
}
const clickText = async (text) => {
  const el = await page.waitForSelector(`::-p-text(${text})`);
  await el.click();
};

await nav('/', '/', 'anonymous · login mode');
await clickText('register');
await snap('/', 'anonymous · register mode');
await clickText('login');

await page.type('#username', alice);
await page.type('#passphrase', PASS);
await clickText('authenticate');
await page.waitForSelector('::-p-text(select a conversation to begin)');
await snap('/chat', 'ready · no conversation selected');
await clickText(bob);
await page.waitForSelector('::-p-text(Deploy)');
await snap('/chat', 'ready · conversation with messages');

await nav('/chat', '/chat', 'need-unlock');
await page.evaluate(() => localStorage.clear());
await nav('/chat', '/chat → /', 'need-login (SessionGate redirect)');

const result = await flow.createFlowResult();
const scores = result.steps.map((s, i) => ({
  ...steps[i],
  url: s.lhr.finalDisplayedUrl,
  score: Math.round(s.lhr.categories.accessibility.score * 100),
  failing: Object.values(s.lhr.audits)
    .filter((a) => a.score === 0 && a.scoreDisplayMode === 'binary')
    .map((a) => a.id),
}));
// "checking": prerendered /chat before hydration (app JS blocked so it holds).
{
  const p = await browser.newPage();
  await p.setRequestInterception(true);
  p.on('request', (r) =>
    /\/_next\/static\/.*\.js/.test(r.url()) ? r.abort() : r.continue(),
  );
  await p.goto(`${BASE}/chat`);
  await p.waitForSelector('::-p-text(loading...)');
  const { lhr } = await snapshot(p, {
    config: {
      extends: 'lighthouse:default',
      settings: {
        onlyCategories: ['accessibility'],
        formFactor: 'desktop',
        screenEmulation: { disabled: true },
      },
    },
  });
  scores.unshift({
    route: '/chat',
    state: 'checking (prerendered loading, pre-hydration)',
    mode: 'snapshot',
    url: lhr.finalDisplayedUrl,
    score: Math.round(lhr.categories.accessibility.score * 100),
    failing: Object.values(lhr.audits)
      .filter((x) => x.score === 0 && x.scoreDisplayMode === 'binary')
      .map((x) => x.id),
  });
}
for (const s of scores)
  console.log(
    `${s.route} [${s.state}] (${s.mode}): ${s.score}  ${s.failing.join(', ')}`,
  );
fs.writeFileSync(
  path.join(OUT, `lighthouse-${label}.json`),
  JSON.stringify(scores, null, 2),
);
await browser.close();
process.exit(0);
