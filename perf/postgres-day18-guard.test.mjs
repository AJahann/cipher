import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(
  new URL('../packages/api/package.json', import.meta.url),
);
const cli = require.resolve('tsx/cli');
const script = fileURLToPath(new URL('./postgres-day18.mjs', import.meta.url));

function refuses(url, args, message) {
  const result = spawnSync(process.execPath, [cli, script, ...args], {
    env: { ...process.env, DAY18_BENCH_DATABASE_URL: url },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
  assert.doesNotMatch(
    result.stderr,
    /ECONNREFUSED|password authentication failed/,
  );
}

test('refuses a remote database before any connection', () => {
  refuses(
    'postgresql://example.invalid/cipher_day18_bench',
    ['--reset'],
    /Only a plain PostgreSQL URL/,
  );
});

test('refuses a different local database before any connection', () => {
  refuses(
    'postgresql://127.0.0.1/cipher_production',
    ['--reset'],
    /Only a plain PostgreSQL URL/,
  );
});

test('refuses URL query overrides before any connection', () => {
  refuses(
    'postgresql://127.0.0.1/cipher_day18_bench?host=example.invalid',
    ['--reset'],
    /Only a plain PostgreSQL URL/,
  );
});

test('requires explicit reset even for the designated local database', () => {
  refuses(
    'postgresql://127.0.0.1/cipher_day18_bench',
    [],
    /Explicit --reset is required/,
  );
});
