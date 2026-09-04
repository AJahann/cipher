import path from 'node:path';

export const PASSPHRASE = 's3cr3t-pass';

export type Role = 'alice' | 'bob';

export const AUTH_DIR = path.resolve('playwright/.auth');

export const storageStateFor = (role: Role): string =>
  path.join(AUTH_DIR, `${role}.json`);

export const USERS_FILE = path.join(AUTH_DIR, 'users.json');
