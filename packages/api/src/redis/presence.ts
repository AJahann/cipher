/* oxlint-disable no-await-in-loop -- Sequential bounded polling/lease reads avoid a Redis command burst. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PresenceState } from '@chat-app/shared/contracts';
import type { RedisRuntime } from './runtime';

/** Atomic lease mutation/pruning, using the Redis clock. No keyspace events. */
const LEASE = `
  local clock = redis.call('TIME')
  local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
  local known = redis.call('ZSCORE', KEYS[2], ARGV[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
  if ARGV[2] == 'renew' then
    redis.call('ZADD', KEYS[1], now + tonumber(ARGV[4]), ARGV[3])
  elseif ARGV[2] == 'remove' then
    redis.call('ZREM', KEYS[1], ARGV[3])
  end
  local count = redis.call('ZCARD', KEYS[1])
  if count > 0 then
    local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    redis.call('ZADD', KEYS[2], first[2], ARGV[1])
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]) * 2)
    if not known then
      redis.call('PUBLISH', ARGV[5], cjson.encode({userId=ARGV[1]}))
    end
    return 1
  end
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  if known then
    redis.call('PUBLISH', ARGV[5], cjson.encode({userId=ARGV[1]}))
  end
  return 0
`;
interface Connection {
  id: string;
  userId: string;
  authorize: () => Promise<void>;
  peers: () => Promise<string[]>;
  send: (states: PresenceState[], available: boolean) => void;
}
type Tracked = Connection & {
  token: string;
  active: boolean;
  working: boolean;
  dirty: boolean;
  peersKnown: Set<string>;
};

export class Presence {
  private readonly connections = new Map<string, Tracked>();
  private readonly timer: ReturnType<typeof setInterval>;
  private sweeping = false;
  private nextRefresh = 0;
  readonly dueKey: string;
  private readonly prefix: string;
  private readonly changed = () => this.reconcileAll();
  private readonly transition = (raw: string) => {
    try {
      if (Buffer.byteLength(raw) > 128) return;
      const parsed = z
        .object({ userId: z.uuid() })
        .strict()
        .safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      const value = parsed.data;
      for (const entry of this.connections.values()) {
        if (entry.peersKnown.has(value.userId)) this.schedule(entry);
      }
    } catch (_error) {
      /* Malformed infrastructure event is not an authority. */
    }
  };

  constructor(
    private readonly redis: RedisRuntime,
    readonly leaseMs = 15_000,
  ) {
    this.prefix = `{${redis.namespace}:presence:v1}`;
    this.dueKey = `${this.prefix}:due`;
    redis.on('state', this.changed);
    redis.on('transition', this.transition);
    // Tick also reconciles missed notifications, new memberships and outages.
    this.timer = setInterval(() => {
      if (Date.now() >= this.nextRefresh) {
        this.nextRefresh = Date.now() + Math.floor(leaseMs / 3);
        this.reconcileAll();
      }
      void this.sweep();
    }, 1000);
    this.timer.unref();
  }

  track(connection: Connection) {
    const entry: Tracked = {
      ...connection,
      token: randomUUID(),
      active: true,
      working: false,
      dirty: false,
      peersKnown: new Set(),
    };
    this.connections.set(entry.id, entry);
    this.schedule(entry);
    return () => {
      entry.active = false;
      this.connections.delete(entry.id);
      void this.lease(entry.userId, 'remove', entry.token).catch(() => {});
    };
  }

  sync(id: string) {
    const entry = this.connections.get(id);
    if (entry) this.schedule(entry);
  }

  private reconcileAll() {
    for (const entry of this.connections.values()) this.schedule(entry);
  }

  private schedule(entry: Tracked) {
    if (!entry.active) return;
    if (entry.working) {
      entry.dirty = true;
      return;
    }
    entry.working = true;
    void this.reconcile(entry)
      .catch(() => {
        // PG authority/membership failures fail closed: send no presence.
      })
      .finally(() => {
        entry.working = false;
        if (entry.dirty) {
          entry.dirty = false;
          this.schedule(entry);
        }
      });
  }

  private async reconcile(entry: Tracked) {
    await entry.authorize();
    const peers = await entry.peers();
    entry.peersKnown = new Set(peers);
    if (!entry.active) return;
    let available = this.redis.presenceReady;
    let states: PresenceState[];
    try {
      await this.lease(entry.userId, 'renew', entry.token);
      if (!entry.active) {
        await this.lease(entry.userId, 'remove', entry.token);
        return;
      }
      if (!available) throw new Error('PRESENCE_UNAVAILABLE');
      states = [];
      for (const userId of peers) {
        const online = await this.lease(userId, 'read', '');
        states.push({ userId, status: online ? 'online' : 'offline', online });
      }
      if (!this.redis.presenceReady) throw new Error('PRESENCE_UNAVAILABLE');
    } catch (_error) {
      available = false;
      states = peers.map((userId) => ({
        userId,
        status: 'unknown',
        online: null,
      }));
    }
    // Revocation must still be checked after potentially slow shared-state work.
    await entry.authorize();
    if (entry.active) entry.send(states, available);
  }

  private lease(
    userId: string,
    operation: 'renew' | 'remove' | 'read',
    token: string,
  ) {
    return this.redis.command(async (client) =>
      Boolean(
        await client.eval(
          LEASE,
          2,
          `${this.prefix}:user:${userId}`,
          this.dueKey,
          userId,
          operation,
          token,
          this.leaseMs,
          this.redis.channel,
        ),
      ),
    );
  }

  private async sweep() {
    if (this.sweeping || !this.redis.presenceReady) return;
    this.sweeping = true;
    try {
      const due = await this.redis.command(async (client) => {
        const clock = await client.time();
        const now =
          Number(clock[0]) * 1000 + Math.floor(Number(clock[1]) / 1000);
        return client.zrangebyscore(this.dueKey, '-inf', now, 'LIMIT', 0, 100);
      });
      for (const userId of due) await this.lease(userId, 'read', '');
    } catch (_error) {
      /* Unknown on failure, never manufacture an offline event. */
    } finally {
      this.sweeping = false;
    }
  }

  close() {
    clearInterval(this.timer);
    this.redis.off('state', this.changed);
    this.redis.off('transition', this.transition);
    for (const entry of this.connections.values()) entry.active = false;
    this.connections.clear();
    // Shutdown/crash cleanup is bounded by leases even without Redis access.
  }
}
