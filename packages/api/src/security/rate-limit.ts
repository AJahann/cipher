import { AppError } from '../http/errors';

/** Single-instance fixed windows, bounded in both work and key count. */
export function createLimiter(
  limit: number,
  windowMs: number,
  maxKeys = 10_000,
) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()) => {
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && entries.size >= maxKeys) {
        for (const [id, value] of entries) {
          if (value.resetAt <= now) entries.delete(id);
        }
        // Fail closed rather than evicting live windows to bypass limits.
        if (entries.size >= maxKeys) throw new AppError('RATE_LIMITED');
      }
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) throw new AppError('RATE_LIMITED');
  };
}
