/* oxlint-disable no-await-in-loop -- Sequential bounded polling/lease reads avoid a Redis command burst. */
import { createHash, randomUUID } from 'node:crypto';
import { usersPageSchema, type UsersPage } from '@chat-app/shared/contracts';
import { AppError } from '../http/errors';
import { decodeCursor } from '../http/cursor';
import type { RedisRuntime } from './runtime';

export const DIRECTORY_TTL_MS = 10_000;
const LOCK_MS = 2000;
const ACQUIRE = `
  if not redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then
    return 0
  end
  local clock = redis.call('TIME')
  return clock[1] * 1000 + math.floor(clock[2] / 1000) + tonumber(ARGV[3])
`;
const FILL = `
  if redis.call('GET', KEYS[1]) == ARGV[1]
     and redis.call('GET', KEYS[2]) == ARGV[2] then
    local clock = redis.call('TIME')
    local remaining = tonumber(ARGV[4]) - (clock[1] * 1000 + math.floor(clock[2] / 1000))
    if remaining <= 0 then return 0 end
    redis.call('SET', KEYS[3], ARGV[3], 'PX', remaining)
    return 1
  end
  return 0
`;
export const RELEASE_LOCK = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;
interface Request {
  caller: string;
  limit: number;
  cursorId?: string;
}
interface CachedPage {
  page: UsersPage;
  cache: 'hit' | 'miss' | 'fallback';
}

export class DirectoryCache {
  private readonly inFlight = new Map<string, Promise<CachedPage>>();
  private activeReads = 0;
  readonly generationKey: string;

  constructor(private readonly redis: RedisRuntime) {
    // Shared hash tag keeps generation/lock/page Lua keys in one slot.
    this.generationKey = `{${redis.namespace}:directory:v1}:generation`;
  }

  async invalidate() {
    // New random epochs never reuse a generation after restart/eviction.
    // Post-commit, best effort. Failure is bounded by the page's original TTL.
    try {
      await this.redis.command((client) =>
        client.set(this.generationKey, randomUUID()),
      );
      return true;
    } catch (_error) {
      return false;
    }
  }

  read(request: Request, load: () => Promise<UsersPage>): Promise<CachedPage> {
    const logicalKey = createHash('sha256')
      .update(
        JSON.stringify([
          request.caller,
          request.limit,
          request.cursorId ?? null,
        ]),
      )
      .digest('hex');
    const existing = this.inFlight.get(logicalKey);
    if (existing) return existing;
    if (this.inFlight.size >= 256)
      return Promise.reject(new AppError('RATE_LIMITED'));
    const result = this.readOnce(logicalKey, request, load).finally(() =>
      this.inFlight.delete(logicalKey),
    );
    this.inFlight.set(logicalKey, result);
    return result;
  }

  private async database(load: () => Promise<UsersPage>) {
    // No unbounded queue, including during an outage or many distinct misses.
    if (this.activeReads >= 8) throw new AppError('RATE_LIMITED');
    this.activeReads += 1;
    try {
      return await load();
    } finally {
      this.activeReads -= 1;
    }
  }

  private async readOnce(
    logicalKey: string,
    request: Request,
    load: () => Promise<UsersPage>,
  ): Promise<CachedPage> {
    const token = randomUUID();
    let generation: string;
    let pageKey: string;
    let lockKey: string;
    let deadline: number;
    try {
      const value = await this.redis.command(async (client) => {
        await client.set(this.generationKey, randomUUID(), 'NX');
        return client.get(this.generationKey);
      });
      if (!value) throw new Error('REDIS_UNAVAILABLE');
      generation = value;
      pageKey = `{${this.redis.namespace}:directory:v1}:${generation}:${logicalKey}`;
      lockKey = `${pageKey}:lock`;
      const cached = await this.get(pageKey, request);
      if (cached) return { page: cached, cache: 'hit' };
      deadline = Number(
        await this.redis.command((client) =>
          client.eval(ACQUIRE, 1, lockKey, token, LOCK_MS, DIRECTORY_TTL_MS),
        ),
      );
      if (!deadline) {
        // Wait briefly for another process. Beyond this budget use bounded PG
        // work, not an unbounded wait/queue or an unsafe lock steal.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          const page = await this.get(pageKey, request);
          if (page) return { page, cache: 'hit' };
        }
      }
    } catch (_error) {
      return { page: await this.database(load), cache: 'fallback' };
    }
    if (!deadline)
      return { page: await this.database(load), cache: 'fallback' };
    // Redis fixes the expiry deadline before the DB read. Fill computes the
    // remaining TTL on Redis too, so transport delay cannot extend freshness.
    try {
      const page = await this.database(load);
      try {
        await this.redis.command((client) =>
          client.eval(
            FILL,
            3,
            this.generationKey,
            lockKey,
            pageKey,
            generation,
            token,
            JSON.stringify(page),
            deadline,
          ),
        );
      } catch (_error) {
        // Return the authoritative DB response even if cache population fails.
      }
      return { page, cache: 'miss' };
    } finally {
      try {
        await this.redis.command((client) =>
          client.eval(RELEASE_LOCK, 1, lockKey, token),
        );
      } catch (_error) {
        // Expiring lock is the backstop; never delete another owner's lock.
      }
    }
  }

  private async get(key: string, request: Request) {
    const raw = await this.redis.command((client) => client.get(key));
    if (!raw || Buffer.byteLength(raw) > 32 * 1024) return null;
    const parsed = usersPageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.items.length > request.limit)
      return null;
    let previous = request.cursorId ?? '';
    for (const user of parsed.data.items) {
      if (
        user.username.length > 32 ||
        user.id !== user.id.toLowerCase() ||
        user.id === request.caller ||
        user.id <= previous
      )
        return null;
      previous = user.id;
    }
    if (
      parsed.data.nextCursor !== null &&
      (parsed.data.items.length !== request.limit ||
        decodeCursor('users', parsed.data.nextCursor) !== previous)
    )
      return null;
    return parsed.data;
  }
}
