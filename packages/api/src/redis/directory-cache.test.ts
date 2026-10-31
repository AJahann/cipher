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

describe('untrusted cached directory pages', () => {
  const caller = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const peer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  it.each([
    'not-json',
    'x'.repeat(32 * 1024 + 1),
    JSON.stringify({
      items: [{ id: caller, username: 'self' }],
      nextCursor: null,
    }),
    JSON.stringify({
      items: [{ id: peer, username: 'x'.repeat(33) }],
      nextCursor: null,
    }),
    JSON.stringify({
      items: [{ id: peer.toUpperCase(), username: 'peer' }],
      nextCursor: null,
    }),
    JSON.stringify({
      items: [
        { id: peer, username: 'peer' },
        { id: peer, username: 'duplicate' },
      ],
      nextCursor: null,
    }),
    JSON.stringify({ items: [], nextCursor: 'invalid-continuation' }),
  ])(
    'uses the database instead of an invalid/oversized cached page (case %#)',
    async (raw) => {
      const runtime = new RedisRuntime(undefined);
      const client = {
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValueOnce('epoch').mockResolvedValue(raw),
        eval: vi.fn().mockResolvedValue(Date.now() + 10_000),
      };
      vi.spyOn(runtime, 'command').mockImplementation((work) =>
        work(client as never),
      );
      const load = vi.fn(() =>
        Promise.resolve({ items: [], nextCursor: null }),
      );
      const result = await new DirectoryCache(runtime).read(
        { caller, limit: 2 },
        load,
      );
      expect(result.cache).not.toBe('hit');
      expect(result.page).toEqual({ items: [], nextCursor: null });
      expect(load).toHaveBeenCalledOnce();
      runtime.close();
    },
  );
});
