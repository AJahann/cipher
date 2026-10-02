// One-off: scan only the prerendered "checking" state and merge it into an
// existing results file. Used to backfill the baseline after the state was
// added to scan.mjs. Usage: node a11y/scan-checking.mjs <label>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const file = path.resolve(`a11y/results/axe-${process.argv[2] ?? 'run'}.json`);
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.route('**/_next/static/**/*.js', (r) => r.abort());
await page.goto(`${BASE}/chat`);
await page.getByText('loading...').waitFor();
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
const entry = {
  route: '/chat',
  state: 'checking (prerendered loading, pre-hydration)',
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
};
const all = JSON.parse(fs.readFileSync(file, 'utf8')).filter(
  (e) => e.state !== entry.state,
);
fs.writeFileSync(file, JSON.stringify([entry, ...all], null, 2));
console.log(
  entry.violations
    .map((v) => `${v.id}(${v.impact},${v.nodes.length})`)
    .join(', ') || 'clean',
);
await browser.close();
process.exit(0);
