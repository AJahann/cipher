import { expect, it, vi } from 'vitest';
import { Presence } from './presence';
import { RedisRuntime } from './runtime';

it('missing Redis means unknown, never an invented offline state', async () => {
  const redis = new RedisRuntime(undefined);
  const presence = new Presence(redis, 3000);
  const send = vi.fn();
  const stop = presence.track({
    id: 'test-connection',
    userId: 'me',
    authorize: () => Promise.resolve(),
    peers: () => Promise.resolve(['peer']),
    send,
  });
  await vi.waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      [{ userId: 'peer', status: 'unknown', online: null }],
      false,
    ),
  );
  stop();
  presence.close();
  redis.close();
});
