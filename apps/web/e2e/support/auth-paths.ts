import path from 'node:path';

// One passphrase for every test identity. Fixed value = deterministic.
export const PASSPHRASE = 's3cr3t-pass';

export type Role = 'alice' | 'bob';

// Resolved from process.cwd(), which is the repo root when Playwright runs
// (that's where playwright.config.ts lives). Matches the gitignored
// `/playwright/.auth/` entry.
export const AUTH_DIR = path.resolve('playwright/.auth');

export const storageStateFor = (role: Role): string =>
  path.join(AUTH_DIR, `${role}.json`);

// Setup writes the run's usernames here; fixtures/specs read them at runtime
// (never at import time — this file may not exist yet during collection).
export const USERS_FILE = path.join(AUTH_DIR, 'users.json');
