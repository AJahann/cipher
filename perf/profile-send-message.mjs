import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseURL = process.env.PERF_WEB_URL ?? 'http://127.0.0.1:3000';
const repetitions = Number(process.env.PERF_RUNS ?? 20);
const cpuThrottleRate = Number(process.env.PERF_CPU_THROTTLE ?? 4);
const passphrase = 'cipher-performance-passphrase';
const message = 'fixed performance message';

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function summarize(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    worst: Math.max(...values),
  };
}

function metricMap(result) {
  return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/local/bin/chromium',
  headless: true,
});
const bootstrapContext = await browser.newContext();
const bootstrapPage = await bootstrapContext.newPage();

await bootstrapPage.goto(baseURL);
await bootstrapPage.getByRole('button', { name: 'register' }).click();
await bootstrapPage.getByLabel('username', { exact: true }).fill('perf-sender');
await bootstrapPage
  .getByLabel('passphrase', { exact: true })
  .fill(passphrase);
await bootstrapPage
  .getByLabel('confirm passphrase', { exact: true })
  .fill(passphrase);
await bootstrapPage
  .getByRole('button', { name: 'generate keys + register' })
  .click();
await bootstrapPage.waitForURL('**/chat');
const storageState = await bootstrapContext.storageState();
await bootstrapContext.close();

const context = await browser.newContext({ storageState });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });

await page.addInitScript(() => {
  window.__sendPaintMeasurements = [];
  window.__sendTargetText = '';

  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('button');
      if (button?.getAttribute('aria-label') !== 'Send message') return;

      const startedAt = performance.now();
      const targetText = window.__sendTargetText;
      const observer = new MutationObserver(() => {
        const paintedMessage = [...document.querySelectorAll('p')].find(
          (node) => node.textContent === targetText,
        );
        if (!paintedMessage) return;

        observer.disconnect();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.__sendPaintMeasurements.push(
              performance.now() - startedAt,
            );
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
    true,
  );
});

async function prepareInteraction() {
  await page.goto(`${baseURL}/chat`);
  await page.getByLabel('passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'unlock', exact: true }).click();
  await page.getByRole('button', { name: 'perf-contact' }).click();
  const textbox = page.getByRole('textbox');
  await textbox.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const textbox = document.querySelector('textarea');
    return textbox && !textbox.disabled;
  });
  await textbox.fill(message);
  await page
    .getByRole('button', { name: 'Send message' })
    .waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = document.querySelector(
      'button[aria-label="Send message"]',
    );
    return button && !button.disabled;
  });
  await page.evaluate((targetText) => {
    window.__sendTargetText = targetText;
  }, message);
}

// Warm the production chunks, crypto runtime, HTTP cache, and socket path.
await prepareInteraction();
await page.getByRole('button', { name: 'Send message' }).click();
await page.waitForFunction(() => window.__sendPaintMeasurements.length === 1);

const runs = [];
for (let run = 1; run <= repetitions; run += 1) {
  await prepareInteraction();
  const before = metricMap(await cdp.send('Performance.getMetrics'));
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.waitForFunction(
    () => window.__sendPaintMeasurements.length === 1,
  );
  const after = metricMap(await cdp.send('Performance.getMetrics'));
  const duration = await page.evaluate(
    () => window.__sendPaintMeasurements.at(-1),
  );

  runs.push({
    run,
    durationMs: duration,
    taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
    scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
    styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
  });
}

const output = {
  experiment: {
    interaction: 'Activate Send message → pending bubble painted',
    browser: `Chromium ${browser.version()}`,
    build: 'Next.js production build',
    hardware: `host hardware; ${cpuThrottleRate}x CPU throttling`,
    messageCountBeforeEachRun: 0,
    cache: 'warm browser HTTP cache; fresh page and React state per run',
    network: 'unthrottled localhost fixture; ack delayed 250 ms',
    startMark: 'capturing click event on the Send message button',
    endMark: 'second requestAnimationFrame after the message paragraph enters the DOM',
    repetitions,
    strictMode: 'production build; development Strict Mode timings excluded',
  },
  runs,
  summary: {
    durationMs: summarize(runs.map((run) => run.durationMs)),
    taskMs: summarize(runs.map((run) => run.taskMs)),
    scriptMs: summarize(runs.map((run) => run.scriptMs)),
    layoutMs: summarize(runs.map((run) => run.layoutMs)),
    styleMs: summarize(runs.map((run) => run.styleMs)),
  },
};

const outputPath =
  process.env.PERF_OUTPUT ?? 'perf/send-message-profile.json';
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output.summary, null, 2));

await context.close();
await browser.close();