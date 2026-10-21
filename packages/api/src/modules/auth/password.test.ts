import { describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { hashPassword, verifyPassword } from './password';

describe('account password hashing', () => {
  it('uses every byte of long and multibyte passphrases', async () => {
    const password = '界'.repeat(30) + 'original';
    const stored = await hashPassword(password);
    expect(stored).toMatch(/^\$argon2id\$/);
    expect((await verifyPassword(password, stored)).valid).toBe(true);
    expect(
      (await verifyPassword('界'.repeat(30) + 'different', stored)).valid,
    ).toBe(false);
  });
  it('upgrades unambiguous legacy credentials only', async () => {
    const stored = await bcrypt.hash('safe-legacy-password', 4);
    const result = await verifyPassword('safe-legacy-password', stored);
    expect(result.valid).toBe(true);
    expect(result.upgradedHash).toMatch(/^\$argon2id\$/);
    expect((await verifyPassword('wrong', stored)).valid).toBe(false);
  });
  it('refuses long suffix collisions and exactly-72-byte prefix migration', async () => {
    const prefix = 'a'.repeat(72);
    const stored = await bcrypt.hash(prefix + 'original', 4);
    for (const candidate of [
      prefix,
      prefix + 'original',
      prefix + 'different',
    ]) {
      await expect(verifyPassword(candidate, stored)).rejects.toMatchObject({
        code: 'LEGACY_PASSWORD_AMBIGUOUS',
      });
    }
  });
  it('unknown users do not authenticate', async () => {
    expect((await verifyPassword('unknown')).valid).toBe(false);
  });
});
