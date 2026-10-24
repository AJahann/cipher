import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { acceptancePasses, requiredJobs } from './gate.mjs';
import { changedPaths, isDocsOnly } from './scope.mjs';
import { summarize } from './timings.mjs';

test('docs allowlist never excludes runtime, tooling, hidden or unknown files', () => {
  assert.equal(isDocsOnly(['README.md', 'docs/decisions/example.md']), true);
  for (const paths of [
    [],
    ['package.json'],
    ['docs/script.ts'],
    ['apps/web/src/a.ts'],
    ['README.md', '.github/workflows/ci.yml'],
    ['docs/a.md', 'pnpm-lock.yaml'],
  ]) {
    assert.equal(isDocsOnly(paths), false);
  }
});
test('change detection checks both sides of renamed files and validates SHAs', () => {
  const a = 'a'.repeat(40),
    b = 'b'.repeat(40);
  assert.deepEqual(
    changedPaths({ before: a, after: b }, 'push', (args) => {
      assert.deepEqual(args, [
        'diff',
        '--no-renames',
        '--name-only',
        '-z',
        a,
        b,
      ]);
      return 'apps/web/src/a.ts\0docs/a.md\0';
    }),
    ['apps/web/src/a.ts', 'docs/a.md'],
  );
  assert.equal(
    changedPaths({ before: '0'.repeat(40), after: b }, 'push'),
    null,
  );
  assert.equal(changedPaths({}, 'workflow_dispatch'), null);
  assert.equal(changedPaths({ before: '--help', after: b }, 'push'), null);
  assert.deepEqual(
    changedPaths(
      { pull_request: { base: { sha: a }, head: { sha: b } } },
      'pull_request',
      () => 'README.md\0',
    ),
    ['README.md'],
  );
});
function needs(docsOnly = false) {
  return Object.fromEntries([
    ['scope', { result: 'success', outputs: { docs_only: String(docsOnly) } }],
    ...requiredJobs.map((job) => [
      job,
      { result: docsOnly ? 'skipped' : 'success' },
    ]),
  ]);
}
test('gate accepts only successful full acceptance or intentionally skipped docs jobs', () => {
  assert.equal(acceptancePasses(needs()), true);
  assert.equal(acceptancePasses(needs(true)), true);
  for (const state of ['failure', 'cancelled', 'skipped']) {
    const value = needs();
    value.e2e.result = state;
    assert.equal(acceptancePasses(value), false);
  }
  const failedScope = needs(true);
  failedScope.scope.result = 'failure';
  assert.equal(acceptancePasses(failedScope), false);
  const missing = needs();
  delete missing.build;
  assert.equal(acceptancePasses(missing), false);
});
test('timings preserve overlapping job and individual step grain', () => {
  assert.deepEqual(
    summarize([
      {
        name: 'Build',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T00:00:10Z',
        steps: [
          {
            name: 'Compile',
            conclusion: 'success',
            started_at: '2026-01-01T00:00:02Z',
            completed_at: '2026-01-01T00:00:06Z',
          },
        ],
      },
      { name: 'Gate', status: 'in_progress' },
    ]),
    [
      {
        name: 'Build',
        conclusion: 'success',
        seconds: 10,
        steps: [{ name: 'Compile', conclusion: 'success', seconds: 4 }],
      },
    ],
  );
});

test('skipped GitHub jobs do not report negative execution durations', () => {
  assert.equal(
    summarize([
      {
        name: 'Skipped',
        status: 'completed',
        conclusion: 'skipped',
        started_at: '2026-01-01T00:00:02Z',
        completed_at: '2026-01-01T00:00:01Z',
      },
    ])[0].seconds,
    null,
  );
});

test('pinned browser image requires package parity and a fixed runner platform', () => {
  const config = readFileSync(
    new URL('../../playwright.config.ts', import.meta.url),
    'utf8',
  );
  const workflow = readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(config, /\bheadless\s*:\s*false/);
  const image = workflow.match(
    /image: mcr\.microsoft\.com\/playwright:v([\d.]+)-noble@sha256:[a-f\d]{64}/,
  );
  const expected = workflow.match(/PLAYWRIGHT_IMAGE_VERSION: '([\d.]+)'/);
  assert.ok(image);
  assert.ok(expected);
  assert.equal(image[1], expected[1]);
  assert.match(
    workflow,
    /installed !== process\.env\.PLAYWRIGHT_IMAGE_VERSION/,
  );
  assert.match(workflow, /pnpm test:e2e --project=chromium/);
  assert.doesNotMatch(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
});

test('pnpm caches have one writer and E2E is restore-only', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const action = readFileSync(
    new URL('../../.github/actions/pnpm-cache/action.yml', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(workflow, /cache: pnpm/);
  assert.equal((workflow.match(/writer: 'true'/g) ?? []).length, 1);
  assert.match(
    workflow.slice(workflow.indexOf('  build:'), workflow.indexOf('  unit:')),
    /writer: 'true'/,
  );
  assert.doesNotMatch(
    workflow.slice(workflow.indexOf('  e2e:'), workflow.indexOf('  gate:')),
    /writer: 'true'/,
  );
  assert.match(action, /uses: actions\/cache\/restore@v4/);
  assert.match(action, /if: inputs.writer == 'true'/);
  assert.doesNotMatch(action, /restore-keys:/);
});

test('retry diagnostics preserve screenshots and first-retry video/trace', () => {
  const config = readFileSync(
    new URL('../../playwright.config.ts', import.meta.url),
    'utf8',
  );
  assert.match(config, /video: 'on-first-retry'/);
  assert.match(config, /trace: 'on-first-retry'/);
  assert.match(config, /screenshot: 'only-on-failure'/);
  assert.match(config, /retries: env.CI \? 2 : 0/);
});
