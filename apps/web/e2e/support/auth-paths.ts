import fs from 'node:fs';
import path from 'node:path';

export const PASSPHRASE = 's3cr3t-pass';
export const AUTH_DIR = path.resolve('playwright/.auth');

export function createAuthDirectory(
  root: string,
  project: string,
  worker: number,
): string {
  if (!Number.isSafeInteger(worker) || worker < 0)
    throw new RangeError('Invalid worker index');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const name = project.replaceAll(/[^\w-]/g, '_').slice(0, 64) || 'project';
  return fs.mkdtempSync(path.join(root, `${name}-${worker}-`));
}
