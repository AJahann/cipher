import { describe, expect, it, vi } from 'vitest';
import { DirectoryCache } from './directory-cache';
import { RedisRuntime } from './runtime';

describe('bounded directory fallback without Redis', () => {
  it('coalesces identical reads in one process', async () => {
    const runtime = new RedisRuntime(undefined);
    const cache = new DirectoryCache(runtime);
    const load = vi.fn(() => Promise.resolve({ items: [], nextCursor: null }));
    const pages = await Promise.all(
      Array.from({ length: 40 }, () =>
        cache.read({ caller: 'caller', limit: 50 }, load),
      ),
    );
    expect(load).toHaveBeenCalledOnce();
    expect(pages.every((page) => page.cache === 'fallback')).toBe(true);
    runtime.close();
  });

  it('admits only eight active PG reads rather than queuing unbounded misses', async () => {
    const runtime = new RedisRuntime(undefined);
    const cache = new DirectoryCache(runtime);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(async () => {
      await gate;
      return { items: [], nextCursor: null };
    });
    const work = Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        cache.read({ caller: `caller-${index}`, limit: 50 }, load),
      ),
    );
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(8));
    release();
    const results = await work;
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(8);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(12);
    expect(
      results
        .filter((result) => result.status === 'rejected')
        .every((result) => result.reason.code === 'RATE_LIMITED'),
    ).toBe(true);
    runtime.close();
  });
});
