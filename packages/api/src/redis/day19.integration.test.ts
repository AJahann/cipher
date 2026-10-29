/* oxlint-disable max-lines-per-function, no-await-in-loop, vitest/no-conditional-in-test -- Serial fault-injection scenarios poll real process state and traverse cursor pages; assertions remain unconditional. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import {
  createServer,
  createConnection,
  type Socket as TcpSocket,
} from 'node:net';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RELEASE_LOCK } from './directory-cache';
import type { UsersPage } from '@chat-app/shared/contracts';

// oxlint-disable-next-line node/no-process-env -- Explicit opt-in disposable services.
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
// oxlint-disable-next-line node/no-process-env -- A loopback Redis test DB, not production.
const redisUrl = process.env.DAY19_TEST_REDIS_URL;
const namespace = `day19test:${randomUUID()}`;
const origin = 'http://localhost:3000';
const require = createRequire(import.meta.url);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(40);
  }
  throw new Error('Day 19 convergence deadline exceeded');
}

interface Worker {
  child: ChildProcess;
  url: string;
  pid: number;
}
interface Account {
  id: string;
  username: string;
  cookie: string;
}
interface State {
  userId: string;
  status: string;
  online: boolean | null;
}
interface Client {
  socket: Socket;
  states: Map<string, State>;
  events: State[];
  availability: string;
}

describe.skipIf(!databaseUrl || !redisUrl)(
  'Day 19: real PG/Redis and TWO API processes',
  () => {
    const workers: Worker[] = [];
    const clients: Client[] = [];
    const accounts: Account[] = [];
    const conversations: string[] = [];
    const links = new Set<TcpSocket>();
    const evidence: { apiPids: number[]; checks: string[] } = {
      apiPids: [],
      checks: [],
    };
    let pool: Pool;
    let redis: Redis;
    let enabled = true;
    let blackhole = false;
    let proxyUrl: string;
    let a: Worker;
    let b: Worker;
    let alice: Account;
    let bob: Account;
    let mallory: Account;
    let aliceClient: Client;
    let malloryClient: Client;
    let requestId = 0;
    const proxy = createServer((downstream) => {
      if (!enabled) {
        downstream.destroy();
        return;
      }
      const target = new URL(redisUrl!);
      const upstream = createConnection({
        host: target.hostname,
        port: Number(target.port || 6379),
      });
      links.add(downstream);
      links.add(upstream);
      downstream.on('data', (chunk) => {
        if (!blackhole) upstream.write(chunk);
      });
      upstream.on('data', (chunk) => {
        if (!blackhole) downstream.write(chunk);
      });
      const cleanup = () => {
        links.delete(downstream);
        links.delete(upstream);
        downstream.destroy();
        upstream.destroy();
      };
      downstream.on('error', cleanup).on('close', cleanup);
      upstream.on('error', cleanup).on('close', cleanup);
    });

    function command(
      worker: Worker,
      name: string,
    ): Promise<Record<string, number>> {
      requestId += 1;
      const id = requestId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.child.off('message', listener);
          reject(new Error(`IPC timeout: ${name}`));
        }, 5000);
        const listener = (message: {
          id?: number;
          result?: Record<string, number>;
          error?: string;
        }) => {
          if (message.id !== id) return;
          clearTimeout(timer);
          worker.child.off('message', listener);
          if (message.error) reject(new Error(message.error));
          else resolve(message.result ?? {});
        };
        worker.child.on('message', listener);
        worker.child.send({ id, command: name });
      });
    }

    async function startWorker() {
      const child = fork(
        fileURLToPath(new URL('../test/day19-worker.ts', import.meta.url)),
        [],
        {
          execArgv: ['--import', require.resolve('tsx')],
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          env: {
            // oxlint-disable-next-line node/no-process-env -- Isolated subprocess fixture.
            ...process.env,
            DATABASE_URL: databaseUrl!,
            NODE_ENV: 'test',
            BACKEND_PORT: '0',
            CLIENT_ORIGIN: origin,
            SESSION_SECRET: 'day19-disposable-session-secret-not-production',
            REDIS_URL: proxyUrl,
            REDIS_NAMESPACE: namespace,
            PRESENCE_LEASE_MS: '3000',
            GITHUB_AUTH_ENABLED: 'false',
          },
        },
      );
      let diagnostic = '';
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (chunk) => {
        diagnostic = (diagnostic + String(chunk)).slice(-3000);
      });
      const worker = await new Promise<Worker>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`API startup timed out: ${diagnostic}`)),
          15000,
        );
        child.on(
          'message',
          (message: { event?: string; url?: string; pid?: number }) => {
            if (message.event !== 'ready') return;
            clearTimeout(timer);
            resolve({ child, url: message.url!, pid: message.pid! });
          },
        );
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`API exited ${code}: ${diagnostic}`));
        });
      });
      expect(worker.pid).toBe(child.pid);
      workers.push(worker);
      evidence.apiPids.push(worker.pid);
      await eventually(
        async () => (await command(worker, 'stats')).redisReady === 1,
      );
      return worker;
    }

    function request(
      worker: Worker,
      path: string,
      account?: Account,
      init?: RequestInit,
    ) {
      return fetch(`${worker.url}${path}`, {
        ...init,
        headers: {
          ...(account ? { Cookie: account.cookie } : {}),
          ...(init?.body
            ? { 'Content-Type': 'application/json', Origin: origin }
            : {}),
          ...init?.headers,
        },
        signal: AbortSignal.timeout(8000),
      });
    }
    async function register(worker: Worker, label: string) {
      const username = `d19_${label}_${randomUUID().slice(0, 8)}`;
      const response = await request(worker, '/auth/register', undefined, {
        method: 'POST',
        body: JSON.stringify({
          username,
          password: 'day19-test-only-password',
          publicKey: 'test-key',
          wrappedPrivateKey: {
            ciphertext: 'test',
            nonce: 'test',
            salt: 'test',
          },
        }),
      });
      expect(response.status).toBe(201);
      const user = (await response.json()) as { id: string };
      const cookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith('sessionId='))!
        .split(';')[0];
      const account = { id: user.id, username, cookie };
      accounts.push(account);
      return account;
    }
    async function directory(worker: Worker, account: Account, query = '') {
      const response = await request(worker, `/users${query}`, account);
      expect(response.status).toBe(200);
      return {
        cache: response.headers.get('X-Directory-Cache'),
        page: (await response.json()) as UsersPage,
      };
    }
    async function connect(worker: Worker, account: Account) {
      const socket = io(worker.url, {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { Cookie: account.cookie, Origin: origin },
      });
      const client: Client = {
        socket,
        states: new Map(),
        events: [],
        availability: '',
      };
      socket.on('presence:update', (state: State) => {
        client.states.set(state.userId, state);
        client.events.push(state);
      });
      socket.on(
        'presence:snapshot',
        (snapshot: { states: State[]; availability: string }) => {
          client.availability = snapshot.availability;
          client.states = new Map(
            snapshot.states.map((state) => [state.userId, state]),
          );
        },
      );
      clients.push(client);
      const connected = new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      socket.connect();
      await connected;
      await eventually(() => client.availability === 'available');
      return client;
    }
    const state = (client: Client, account: Account) =>
      client.states.get(account.id)?.status;
    const generationKey = `{${namespace}:directory:v1}:generation`;
    const pageKey = (generation: string, account: Account, limit: number) => {
      const digest = createHash('sha256')
        .update(JSON.stringify([account.id, limit, null]))
        .digest('hex');
      return `{${namespace}:directory:v1}:${generation}:${digest}`;
    };

    beforeAll(async () => {
      const target = new URL(redisUrl!);
      assert(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
      assert.equal(target.pathname, '/15');
      pool = new Pool({ connectionString: databaseUrl });
      await migrate(drizzle(pool), {
        migrationsFolder: fileURLToPath(
          new URL('../../drizzle/', import.meta.url),
        ),
      });
      // Correctness fixture, never a scale/performance claim or a production DB.
      assert(
        (await pool.query('SELECT count(*)::int AS count FROM users')).rows[0]
          .count < 50,
      );
      redis = new Redis(redisUrl!, { maxRetriesPerRequest: 0 });
      await redis.ping();
      proxy.listen(0, '127.0.0.1');
      await once(proxy, 'listening');
      const address = proxy.address() as { port: number };
      target.hostname = '127.0.0.1';
      target.port = String(address.port);
      proxyUrl = target.toString();
      a = await startWorker();
      b = await startWorker();
      assert.notEqual(a.pid, b.pid);
      alice = await register(a, 'alice');
      bob = await register(b, 'bob');
      mallory = await register(a, 'mallory');
      await register(b, 'other');
      const dm = await request(a, '/chat/conversations', alice, {
        method: 'POST',
        body: JSON.stringify({ memberId: bob.id }),
      });
      assert.equal(dm.status, 201);
      conversations.push(((await dm.json()) as { id: string }).id);
    }, 40000);

    afterAll(async () => {
      enabled = true;
      blackhole = false;
      for (const client of clients) client.socket.disconnect();
      for (const worker of workers) {
        if (worker.child.exitCode !== null || worker.child.signalCode !== null)
          continue;
        await command(worker, 'stop').catch(() => {
          worker.child.kill('SIGKILL');
        });
      }
      for (const link of links) link.destroy();
      if (proxy.listening)
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      if (redis) {
        const keys = await redis.keys(`*${namespace}*`);
        if (keys.length) await redis.del(...keys);
        redis.disconnect();
      }
      if (pool) {
        await pool.query(
          'DELETE FROM conversations WHERE id = ANY($1::uuid[])',
          [conversations],
        );
        await pool.query(
          "DELETE FROM user_sessions WHERE sess->>'userId' = ANY($1::text[])",
          [accounts.map((account) => account.id)],
        );
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          accounts.map((account) => account.id),
        ]);
        await pool.end();
      }
      // oxlint-disable-next-line node/no-process-env -- Optional sanitized acceptance artifact.
      const path = process.env.DAY19_EVIDENCE_PATH;
      if (path) await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
    }, 20000);

    it('miss → population → cross-process hit; auth/validation and caller keys stay correct', async () => {
      const first = await directory(a, alice, '?limit=2');
      expect(first.cache).toBe('miss');
      expect((await directory(b, alice, '?limit=02')).cache).toBe('hit');
      const other = await directory(b, bob, '?limit=2');
      expect(other.cache).toBe('miss');
      expect(
        other.page.items.some((user: { id: string }) => user.id === bob.id),
      ).toBe(false);
      expect((await request(a, '/users?limit=2')).status).toBe(401);
      expect((await request(a, '/users?limit=0', alice)).status).toBe(400);
      expect(
        (await request(a, '/users?limit=2&cursor=bad', alice)).status,
      ).toBe(400);
      await expect(
        redis.pttl(pageKey((await redis.get(generationKey))!, alice, 2)),
      ).resolves.toBeGreaterThan(0);
      evidence.checks.push(
        'miss/population/hit across PIDs; normalized limits; caller isolation; auth/validation before cache',
      );
    });

    it('directory pagination preserves order, self-exclusion, continuation and empty tail', async () => {
      const actual: { id: string; username: string }[] = [];
      let cursor: string | null = null;
      do {
        const result = await directory(
          a,
          alice,
          `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        actual.push(...result.page.items);
        cursor = result.page.nextCursor;
      } while (cursor);
      const expected = await pool.query(
        'SELECT id, username FROM users WHERE id <> $1 ORDER BY id',
        [alice.id],
      );
      expect(actual).toEqual(expected.rows);
      expect(new Set(actual.map((user) => user.id)).size).toBe(actual.length);
      evidence.checks.push(
        'directory pages equal ordered PostgreSQL reference, no duplicate/self rows, exact continuation',
      );
    });

    it('successful post-registration epoch fencing rejects an old in-flight fill', async () => {
      const oldGeneration = (await redis.get(generationKey))!;
      await command(a, 'pause-fill');
      const paused = new Promise<void>((resolve) => {
        const listener = (message: { event?: string }) => {
          if (message.event === 'fill-paused') {
            a.child.off('message', listener);
            resolve();
          }
        };
        a.child.on('message', listener);
      });
      const pending = directory(a, alice, '?limit=7');
      await paused;
      await register(b, 'epoch');
      await expect(redis.get(generationKey)).resolves.not.toBe(oldGeneration);
      await command(a, 'release-fill');
      await pending;
      await expect(
        redis.get(pageKey(oldGeneration, alice, 7)),
      ).resolves.toBeNull();
      const fresh = await directory(b, alice, '?limit=7');
      const expected = await pool.query(
        'SELECT id, username FROM users WHERE id <> $1 ORDER BY id LIMIT 8',
        [alice.id],
      );
      expect(fresh.page.items).toEqual(expected.rows.slice(0, 7));
      evidence.checks.push(
        'registration across processes rotates epoch; paused pre-write fill cannot repopulate old generation',
      );
    });

    it('bounds identical concurrent misses and releases locks only by owner', async () => {
      const beforeA = (await command(a, 'stats')).reads;
      const beforeB = (await command(b, 'stats')).reads;
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          directory(index % 2 ? a : b, alice, '?limit=13'),
        ),
      );
      expect(
        results.every(
          (result) =>
            JSON.stringify(result.page) === JSON.stringify(results[0].page),
        ),
      ).toBe(true);
      const reads =
        (await command(a, 'stats')).reads -
        beforeA +
        (await command(b, 'stats')).reads -
        beforeB;
      expect(reads).toBeLessThanOrEqual(2);
      expect(reads).toBeGreaterThanOrEqual(1);
      const lock = `{${namespace}:test}:owner-lock`;
      await redis.set(lock, 'owner-b', 'PX', 1500);
      await expect(redis.eval(RELEASE_LOCK, 1, lock, 'owner-a')).resolves.toBe(
        0,
      );
      await expect(redis.get(lock)).resolves.toBe('owner-b');
      await expect(redis.pttl(lock)).resolves.toBeGreaterThan(0);
      await expect(redis.eval(RELEASE_LOCK, 1, lock, 'owner-b')).resolves.toBe(
        1,
      );
      evidence.checks.push(
        `40 identical cross-process misses used ${reads} PG reads; expiring lock release is owner-only`,
      );
    });

    it('delivers cross-process presence only to authenticated conversation peers', async () => {
      aliceClient = await connect(a, alice);
      malloryClient = await connect(a, mallory);
      const bobClient = await connect(b, bob);
      await eventually(
        () =>
          state(aliceClient, bob) === 'online' &&
          state(bobClient, alice) === 'online',
      );
      expect(malloryClient.states.size).toBe(0);
      expect(
        malloryClient.events.some((event) => event.userId === bob.id),
      ).toBe(false);
      evidence.checks.push(
        `authorised presence across API PIDs ${a.pid}/${b.pid}; unrelated user receives no peer metadata`,
      );
      bobClient.socket.disconnect();
      await eventually(() => state(aliceClient, bob) === 'offline');
    });

    it('closing one tab keeps the other online; last disconnect converges offline', async () => {
      const first = await connect(a, bob);
      const second = await connect(b, bob);
      await eventually(() => state(aliceClient, bob) === 'online');
      const start = aliceClient.events.length;
      first.socket.disconnect();
      await pause(1200);
      expect(state(aliceClient, bob)).toBe('online');
      expect(
        aliceClient.events
          .slice(start)
          .some((event) => event.userId === bob.id && event.online === false),
      ).toBe(false);
      second.socket.disconnect();
      await eventually(() => state(aliceClient, bob) === 'offline');
      evidence.checks.push(
        'two per-connection leases across processes; one-tab close stays online; last close becomes offline',
      );
    });

    it('SIGKILL of one API loses its online contribution after lease expiry', async () => {
      await connect(b, bob);
      await eventually(() => state(aliceClient, bob) === 'online');
      b.child.kill('SIGKILL');
      await once(b.child, 'exit');
      await eventually(() => state(aliceClient, bob) === 'offline', 7000);
      expect(state(aliceClient, bob)).toBe('offline');
      b = await startWorker();
      evidence.checks.push(
        'real API process SIGKILL without cleanup; surviving API prunes expired lease and publishes offline',
      );
    }, 20000);

    it('subscriber recovery supplies a current snapshot even when the transition was missed', async () => {
      await command(a, 'subscriber-down');
      await eventually(() => aliceClient.availability === 'unknown');
      const remote = await connect(b, bob);
      expect(state(aliceClient, bob)).toBe('unknown');
      await command(a, 'subscriber-up');
      await eventually(
        () =>
          aliceClient.availability === 'available' &&
          state(aliceClient, bob) === 'online',
      );
      remote.socket.disconnect();
      await eventually(() => state(aliceClient, bob) === 'offline');
      evidence.checks.push(
        'subscriber disconnection marks unknown; resubscription snapshot repairs a missed transition',
      );
    });

    it('a blackholed Redis command times out; connection outage falls back to PG and reports unknown', async () => {
      await directory(a, alice, '?limit=100');
      const epoch = (await redis.get(generationKey))!;
      const hotKey = pageKey(epoch, alice, 100);
      const initialTtl = await redis.pttl(hotKey);
      expect(initialTtl).toBeGreaterThan(0);
      expect(initialTtl).toBeLessThanOrEqual(10000);
      blackhole = true;
      const started = performance.now();
      const timed = await directory(a, alice, '?limit=17');
      expect(performance.now() - started).toBeLessThan(2000);
      expect(timed.cache).toBe('fallback');
      blackhole = false;
      // Reset timed-out command streams rather than assuming protocol positions.
      enabled = false;
      for (const link of links) link.destroy();
      await eventually(() => aliceClient.availability === 'unknown');
      const fallback = await directory(b, alice, '?limit=19');
      expect(fallback.cache).toBe('fallback');
      expect((await request(b, '/users?limit=19')).status).toBe(401);
      const added = await register(b, 'outage');
      enabled = true;
      await eventually(() => aliceClient.availability === 'available', 10000);
      // Failed post-commit invalidation is bounded, NOT claimed as coherent.
      await expect(redis.get(generationKey)).resolves.toBe(epoch);
      const remaining = await redis.pttl(hotKey);
      expect(remaining).toBeLessThan(initialTtl);
      expect(remaining).toBeGreaterThan(0);
      {
        const stale = await directory(a, alice, '?limit=100');
        expect(stale.cache).toBe('hit');
        expect(
          stale.page.items.some((user: { id: string }) => user.id === added.id),
        ).toBe(false);
        await pause(remaining + 100);
      }
      const fresh = await directory(a, alice, '?limit=100');
      expect(
        fresh.page.items.some((user: { id: string }) => user.id === added.id),
      ).toBe(true);
      evidence.checks.push(
        'blackholed commands hit bounded timeout; dropped Redis connections use PG, preserve auth and emit unknown, then recover',
      );
      evidence.checks.push(
        'registration invalidation failure explicitly permits stale copy only until its original bounded TTL',
      );
    }, 30000);

    it('revocation remains PG-authoritative across processes, independent of presence', async () => {
      const remote = await connect(b, bob);
      await eventually(() => state(aliceClient, bob) === 'online');
      const response = await request(a, '/auth/logout', bob, {
        method: 'POST',
        headers: { Origin: origin },
      });
      expect(response.status).toBe(200);
      remote.socket.emit(
        'message:send',
        {
          clientMessageId: randomUUID(),
          conversationId: conversations[0],
          ciphertext: 'forbidden',
          nonce: 'test',
          algorithm: 'test',
        },
        () => {},
      );
      await eventually(() => !remote.socket.connected, 6500);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM messages WHERE sender_id=$1',
            [bob.id],
          )
        ).rows[0].count,
      ).toBe(0);
      await eventually(() => state(aliceClient, bob) === 'offline');
      expect((await request(b, '/users', bob)).status).toBe(401);
      expect(
        malloryClient.events.some((event) => event.userId === bob.id),
      ).toBe(false);
      evidence.checks.push(
        'logout on A revokes B socket via PG authority; forbidden send stores nothing and revoked cookie cannot use cache',
      );
    }, 12000);
  },
);
