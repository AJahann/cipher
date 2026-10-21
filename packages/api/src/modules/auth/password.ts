import { Algorithm, hash, verify } from '@node-rs/argon2';
import bcrypt from 'bcrypt';
import { AppError } from '../../http/errors';

const policy = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
let active = 0;
async function bounded<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 4) throw new AppError('RATE_LIMITED');
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
  }
}

export const hashPassword = (password: string) =>
  bounded(() => hash(password, policy));
// A real, fixed-cost hash for unknown identities, not a malformed sentinel.
const dummyHash = hash('cipher-unknown-account-timing-sentinel', policy);

export function verifyPassword(password: string, stored?: string) {
  return bounded(async () => {
    if (!stored) {
      await verify(await dummyHash, password);
      return { valid: false };
    }
    if (stored.startsWith('$argon2id$'))
      return { valid: await verify(stored, password) };
    if (!/^\$2[aby]\$/.test(stored)) return { valid: false };
    const valid = await bcrypt.compare(password, stored);
    if (!valid) return { valid: false };
    // At exactly 72 bytes even a prefix-only credential could match a longer
    // legacy passphrase. Never silently promote that ambiguity into a new hash.
    if (Buffer.byteLength(password, 'utf8') >= 72)
      throw new AppError('LEGACY_PASSWORD_AMBIGUOUS');
    return { valid: true, upgradedHash: await hash(password, policy) };
  });
}
