import { describe, expect, it } from 'vitest';
import { createLimiter } from './rate-limit';
describe('bounded request windows', () => {
  it('limits per key, resets windows and bounds live key cardinality', () => {
    const limit = createLimiter(2, 100, 2);
    limit('a', 0);
    limit('a', 1);
    limit('b', 1);
    expect(() => limit('a', 2)).toThrow();
    expect(() => limit('c', 2)).toThrow();
    expect(() => limit('c', 102)).not.toThrow();
    expect(() => limit('a', 103)).not.toThrow();
  });
});
