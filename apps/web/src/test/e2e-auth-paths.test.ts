import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAuthDirectory } from '../../e2e/support/auth-paths';

const EXPECTED_MODE = process.platform === 'win32' ? 0o666 : 0o700;

describe('E2E worker authentication paths', () => {
  it('isolates simultaneous runs, projects and restarted workers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cipher-auth-paths-'));
    try {
      const directories = [
        createAuthDirectory(root, 'chromium', 0),
        createAuthDirectory(root, 'chromium', 0),
        createAuthDirectory(root, 'chromium', 1),
        createAuthDirectory(root, 'firefox', 0),
        createAuthDirectory(root, '../chromium:linux', 0),
      ];
      expect(new Set(directories).size).toBe(directories.length);
      for (const directory of directories) {
        expect(path.dirname(directory)).toBe(root);
        expect(fs.statSync(directory).mode & 0o777).toBe(EXPECTED_MODE);
      }
      expect(() => createAuthDirectory(root, 'chromium', -1)).toThrow(
        RangeError,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
