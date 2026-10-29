/* oxlint-disable max-lines-per-function, no-await-in-loop, vitest/no-conditional-in-test -- Serial real-process fault injection and bounded state polling, with unconditional assertions. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import {
  createConnection,
  createServer,
  type Socket as TcpSocket,
} from 'node:net';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { io, type Socket } from 'socket.io-client';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { redrive } from './operations';
import { Queue } from 'bullmq';
import { jobId } from './notification-jobs';
import type {
  SendMessageAck,
  SendMessageInput,
} from '@chat-app/shared/contracts';

// oxlint-disable-next-line node/no-process-env -- Explicit disposable-service opt-in.
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
// oxlint-disable-next-line node/no-process-env -- Loopback test Redis DB 15 only.
const redisUrl = process.env.DAY20_TEST_REDIS_URL;
// oxlint-disable-next-line node/no-process-env -- Optional sanitized evidence file.
const evidencePath = process.env.DAY20_EVIDENCE_PATH;
const require = createRequire(import.meta.url);
const namespace = `day20test:${randomUUID()}`;
const origin = 'http://localhost:3000';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean | Promise<boolean>, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error('DAY20_CONVERGENCE_TIMEOUT');
}
interface Api {
  child: ChildProcess;
  url: string;
}
interface Account {
  id: string;
  cookie: string;
}
interface Event {
  id: string;
  message_id: string;
  generation: number;
  attempts: number;
  status: string;
  dispatched_at: Date | null;
  last_error: string | null;
  failures: unknown[];
}

describe.skipIf(!databaseUrl || !redisUrl)(
  'Day 20 real async acceptance and recovery',
  () => {
    let api: Api;
    let pool: Pool;
    let redis: Redis;
    let queue: Queue;
    let proxyUrl: string;
    let enabled = true;
    let sender: Account;
    let recipient: Account;
    let senderSocket: Socket;
    let recipientSocket: Socket;
    let conversationId: string;
    let requestId = 0;
    const users: string[] = [];
    const clients: Socket[] = [];
    const workers: Api[] = [];
    const links = new Set<TcpSocket>();
    const received: string[] = [];
    const evidence: { pids: number[]; checks: string[] } = {
      pids: [],
      checks: [],
    };
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
      downstream.pipe(upstream);
      upstream.pipe(downstream);
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
      name: string,
      target = api,
    ): Promise<Record<string, number>> {
      requestId += 1;
      const id = requestId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          target.child.off('message', listener);
          reject(new Error(`IPC_TIMEOUT_${name}`));
        }, 8000);
        const listener = (message: {
          id?: number;
          result?: Record<string, number>;
          error?: string;
        }) => {
          if (message.id !== id) return;
          clearTimeout(timer);
          target.child.off('message', listener);
          if (message.error) reject(new Error(message.error));
          else resolve(message.result ?? {});
        };
        target.child.on('message', listener);
        target.child.send({ id, command: name });
      });
    }
    function window(name: string) {
      return new Promise<void>((resolve) => {
        const { child } = api;
        const listener = (message: { event?: string }) => {
          if (message.event === name) {
            child.off('message', listener);
            resolve();
          }
        };
        child.on('message', listener);
      });
    }
    async function start() {
      const child = fork(
        fileURLToPath(new URL('../test/day20-worker.ts', import.meta.url)),
        [],
        {
          execArgv: ['--import', require.resolve('tsx')],
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          env: {
            // oxlint-disable-next-line node/no-process-env -- Isolated real API child.
            ...process.env,
            DATABASE_URL: databaseUrl!,
            REDIS_URL: proxyUrl,
            REDIS_NAMESPACE: namespace,
            NODE_ENV: 'test',
            SESSION_SECRET: 'day20-disposable-session-secret-32-characters',
            CLIENT_ORIGIN: origin,
            BACKEND_PORT: '0',
            GITHUB_AUTH_ENABLED: 'false',
          },
        },
      );
      let diagnostic = '';
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (chunk) => {
        diagnostic = (diagnostic + String(chunk)).slice(-2000);
      });
      const target = await new Promise<Api>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`API_START_TIMEOUT ${diagnostic}`)),
          20000,
        );
        child.on(
          'message',
          (message: { event?: string; url?: string; pid?: number }) => {
            if (message.event !== 'ready') return;
            clearTimeout(timer);
            assert.equal(message.pid, child.pid);
            resolve({ child, url: message.url! });
          },
        );
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(`API_EXIT ${diagnostic}`));
        });
      });
      workers.push(target);
      evidence.pids.push(child.pid!);
      return target;
    }
    function request(path: string, account?: Account, body?: unknown) {
      return fetch(api.url + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(account ? { Cookie: account.cookie } : {}),
          ...(body
            ? { Origin: origin, 'Content-Type': 'application/json' }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
    }
    async function register() {
      const r = await request('/auth/register', undefined, {
        username: `d20_${randomUUID().slice(0, 12)}`,
        password: 'day20-test-password',
        publicKey: 'test',
        wrappedPrivateKey: { ciphertext: 'test', salt: 'test', nonce: 'test' },
      });
      expect(r.status).toBe(201);
      const { id } = (await r.json()) as { id: string };
      users.push(id);
      return {
        id,
        cookie: r.headers
          .getSetCookie()
          .find((x) => x.startsWith('sessionId='))!
          .split(';')[0],
      };
    }
    async function connect(account: Account) {
      const socket = io(api.url, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { Cookie: account.cookie, Origin: origin },
      });
      clients.push(socket);
      socket.on('message:new', (m: { id: string }) => received.push(m.id));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('SOCKET_BOOTSTRAP_TIMEOUT')),
          5000,
        );
        socket.once('presence:snapshot', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once('connect_error', reject);
      });
      return socket;
    }
    function send(
      overrides: Partial<SendMessageInput> = {},
    ): Promise<SendMessageAck> {
      return senderSocket.timeout(4000).emitWithAck('message:send', {
        conversationId,
        clientMessageId: randomUUID(),
        ciphertext: 'synthetic',
        nonce: 'synthetic',
        algorithm: 'x25519-xsalsa20-poly1305',
        ...overrides,
      });
    }
    async function accept(overrides: Partial<SendMessageInput> = {}) {
      const ack = await send(overrides);
      expect(ack.ok).toBe(true);
      assert(ack.ok);
      return ack;
    }
    async function event(messageId: string): Promise<Event> {
      return (
        await pool.query(
          'SELECT * FROM notification_outbox WHERE message_id=$1',
          [messageId],
        )
      ).rows[0];
    }
    async function completed(messageId: string) {
      await eventually(
        async () => (await event(messageId)).status === 'completed',
      );
    }
    function receivedCount(id: string) {
      return received.filter((value) => value === id).length;
    }
    async function kill() {
      api.child.kill('SIGKILL');
      await once(api.child, 'exit');
    }
    async function reconnect() {
      senderSocket = await connect(sender);
      recipientSocket = await connect(recipient);
    }
    async function stop() {
      await command('stop');
      await once(api.child, 'exit');
    }

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
      assert(
        (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n <
          50,
      );
      redis = new Redis(redisUrl!);
      await redis.ping();
      queue = new Queue('message-notification', {
        prefix: `${namespace}:jobs:v1`,
        connection: {
          host: target.hostname,
          port: Number(target.port || 6379),
          db: 15,
        },
      });
      await new Promise<void>((resolve) =>
        proxy.listen(0, '127.0.0.1', resolve),
      );
      const address = proxy.address();
      assert(address && typeof address === 'object');
      proxyUrl = `redis://127.0.0.1:${address.port}/15`;
      api = await start();
      sender = await register();
      recipient = await register();
      const r = await request('/chat/conversations', sender, {
        memberId: recipient.id,
      });
      assert.equal(r.status, 201);
      conversationId = ((await r.json()) as { id: string }).id;
      await reconnect();
    }, 40000);
    afterAll(async () => {
      for (const socket of clients) socket.disconnect();
      for (const target of workers)
        if (
          target.child.exitCode === null &&
          target.child.signalCode === null
        ) {
          await command('stop', target).catch(() =>
            target.child.kill('SIGKILL'),
          );
        }
      await queue?.close();
      for (const link of links) link.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      if (redis) {
        const keys = await redis.keys(`*${namespace}*`);
        if (keys.length) await redis.del(...keys);
        redis.disconnect();
      }
      if (pool) {
        await pool.query('DELETE FROM conversations WHERE id=$1', [
          conversationId,
        ]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
        await pool.end();
      }
      // oxlint-disable-next-line node/no-process-env -- Optional sanitized local evidence output.
      if (evidencePath)
        await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    });

    it('rollback creates neither row nor intent; invalid commands are not accepted', async () => {
      await pool.query(
        `CREATE FUNCTION day20_reject_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ROLLBACK'; END $$`,
      );
      await pool.query(
        'CREATE TRIGGER day20_reject_intent BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION day20_reject_intent()',
      );
      const id = randomUUID();
      try {
        expect((await send({ clientMessageId: id })).ok).toBe(false);
      } finally {
        await pool.query(
          'DROP TRIGGER day20_reject_intent ON notification_outbox',
        );
        await pool.query('DROP FUNCTION day20_reject_intent()');
      }
      expect(
        (
          await pool.query(
            'SELECT id FROM messages WHERE sender_id=$1 AND client_message_id=$2',
            [sender.id, id],
          )
        ).rowCount,
      ).toBe(0);
      expect((await send({ conversationId: randomUUID() })).ok).toBe(false);
      expect((await send({ ciphertext: '' })).ok).toBe(false);
      evidence.checks.push(
        'message+intent rollback is atomic; validation/membership reject before acceptance',
      );
    });
    it('paused worker and dispatcher do not gate durable acceptance; release performs real socket work', async () => {
      const ack = await accept();
      const intent = await event(ack.message.id);
      expect(intent.status).toBe('pending');
      expect(intent.dispatched_at).toBeNull();
      expect(received).not.toContain(ack.message.id);
      await command('dispatch');
      expect((await command('stats')).waiting).toBeGreaterThanOrEqual(1);
      expect(received).not.toContain(ack.message.id);
      await command('resume');
      await completed(ack.message.id);
      await eventually(() => received.includes(ack.message.id));
      const { data } = (await queue.getJob(jobId(intent.id, 0)))!;
      expect(Object.keys(data).sort()).toEqual(['eventId', 'generation']);
      await command('pause');
      evidence.checks.push(
        'paused dispatcher/consumer do not block durable ack; release emits real notifications with ID-only queue payload',
      );
    });
    it('concurrent replay preserves command conflicts, one message and one logical intent', async () => {
      const id = randomUUID();
      const replies = await Promise.all(
        Array.from({ length: 8 }, () => accept({ clientMessageId: id })),
      );
      expect(new Set(replies.map((r) => r.message.id)).size).toBe(1);
      const conflict = await send({ clientMessageId: id, nonce: 'conflict' });
      expect(conflict.ok).toBe(false);
      expect(
        (
          await pool.query(
            'SELECT o.id FROM messages m JOIN notification_outbox o ON o.message_id=m.id WHERE m.sender_id=$1 AND m.client_message_id=$2',
            [sender.id, id],
          )
        ).rowCount,
      ).toBe(1);
      await command('dispatch');
      await command('resume');
      await completed(replies[0].message.id);
      await command('pause');
      evidence.checks.push(
        '8 concurrent command replays share a message/intent; changed payload conflicts',
      );
    });
    it('transient notification failure retries with backoff and sanitized durable attempts', async () => {
      const ack = await accept();
      await command('fail-one');
      await command('dispatch');
      const started = Date.now();
      await command('resume');
      await completed(ack.message.id);
      const row = await event(ack.message.id);
      expect(row.attempts).toBe(2);
      expect(Date.now() - started).toBeGreaterThanOrEqual(900);
      expect(
        (
          await pool.query('SELECT id FROM messages WHERE id=$1', [
            ack.message.id,
          ])
        ).rowCount,
      ).toBe(1);
      await command('pause');
      evidence.checks.push(
        'injected transient failure backs off and succeeds on durable attempt 2, without another message row',
      );
    });
    it('commit survives API/dispatcher downtime and enqueue-before-marker SIGKILL', async () => {
      const ack = await accept();
      const intent = await event(ack.message.id);
      await kill();
      api = await start();
      await reconnect();
      expect((await event(ack.message.id)).dispatched_at).toBeNull();
      await command('enqueue-window');
      const paused = window('enqueue-window');
      const pending = command('dispatch').catch(() => {});
      await paused;
      expect((await queue.getJob(jobId(intent.id, 0)))!.id).toBe(
        jobId(intent.id, 0),
      );
      expect((await event(ack.message.id)).dispatched_at).toBeNull();
      await kill();
      await pending;
      api = await start();
      await reconnect();
      await command('dispatch');
      expect((await command('stats')).waiting).toBe(1);
      await command('resume');
      await completed(ack.message.id);
      await command('pause');
      evidence.checks.push(
        'committed intent survives API downtime; actual SIGKILL after enqueue/before marker reuses the same stable job ID',
      );
    }, 30000);
    it('side-effect-before-completion SIGKILL may repeat notifications but not persisted messages', async () => {
      const ack = await accept();
      await command('effect-window');
      const paused = window('effect-window');
      await command('dispatch');
      await command('resume');
      await paused;
      await eventually(() => received.includes(ack.message.id));
      const before = receivedCount(ack.message.id);
      expect((await event(ack.message.id)).status).toBe('pending');
      await kill();
      api = await start();
      await reconnect();
      await command('resume');
      await eventually(async () => {
        await command('dispatch');
        return (await event(ack.message.id)).status === 'completed';
      }, 15000);
      await eventually(() => receivedCount(ack.message.id) > before);
      expect(
        (
          await pool.query('SELECT id FROM messages WHERE id=$1', [
            ack.message.id,
          ])
        ).rowCount,
      ).toBe(1);
      expect((await event(ack.message.id)).attempts).toBe(2);
      await command('pause');
      evidence.checks.push(
        'actual SIGKILL after Socket.IO side effect/before SQL completion recovers via lease/stall handling; duplicate hints retain one persisted message',
      );
    }, 25000);
    it('exhausts finite attempts, retains inspectable failure and safely re-drives a new generation', async () => {
      const ack = await accept();
      await command('fail-three');
      await command('dispatch');
      await command('resume');
      await eventually(
        async () => (await event(ack.message.id)).status === 'failed',
        15000,
      );
      const failed = await event(ack.message.id);
      expect(failed.attempts).toBe(3);
      expect(failed.last_error).toBe('NOTIFICATION_ATTEMPT_FAILED');
      expect(failed.failures).toHaveLength(1);
      const job = (await queue.getJob(jobId(failed.id, 0)))!;
      await eventually(async () => (await job.getState()) === 'failed');
      expect(job.failedReason).not.toContain('SECRET');
      await command('dispatch');
      expect((await event(ack.message.id)).attempts).toBe(3);
      const driven = await redrive(pool, failed.id);
      expect(driven.generation).toBe(1);
      await expect(redrive(pool, failed.id)).rejects.toThrow(
        'EVENT_NOT_FAILED',
      );
      await command('dispatch');
      await completed(ack.message.id);
      const recovered = await event(ack.message.id);
      expect(recovered.attempts).toBe(1);
      expect(recovered.failures).toHaveLength(1);
      await expect(queue.getJob(jobId(failed.id, 0))).resolves.toBeDefined();
      await command('pause');
      evidence.checks.push(
        '3 exhausted attempts retain sanitized SQL failure history and failed BullMQ job; explicit redrive increments generation, preserves history, and succeeds',
      );
    }, 25000);
    it('Redis-down sends commit; recovery dispatches; loss of dispatched queue data is repaired from SQL', async () => {
      enabled = false;
      for (const link of links) link.destroy();
      const ack = await accept();
      expect((await event(ack.message.id)).status).toBe('pending');
      await command('dispatch').catch(() => {});
      expect(received).not.toContain(ack.message.id);
      enabled = true;
      await eventually(async () => {
        try {
          await command('dispatch');
          return Boolean((await event(ack.message.id)).dispatched_at);
        } catch (_error) {
          return false;
        }
      }, 15000);
      await stop();
      const keys = await redis.keys(`${namespace}:jobs:v1:*`);
      expect(keys.length).toBeGreaterThan(0);
      await redis.del(...keys);
      api = await start();
      await reconnect();
      await pause(550);
      await command('dispatch');
      await command('resume');
      await completed(ack.message.id);
      await command('pause');
      evidence.checks.push(
        'Redis connection outage does not gate PG acceptance; recovery dispatches; deleting only this fixture queue after dispatch is repaired from retained PG intent',
      );
    }, 30000);
    it('bounds dispatcher batches at 25 and actual active worker claims at four', async () => {
      const replies = await Promise.all(
        Array.from({ length: 30 }, () => accept()),
      );
      const ids = replies.map((r) => r.message.id);
      await command('dispatch');
      expect((await command('stats')).waiting).toBe(25);
      await command('hold-before');
      await command('resume');
      await eventually(async () => (await command('stats')).active === 4);
      expect(
        (
          await pool.query(
            'SELECT id FROM notification_outbox WHERE message_id=ANY($1::uuid[]) AND attempts=1',
            [ids],
          )
        ).rowCount,
      ).toBe(4);
      await command('release-before');
      await eventually(async () => {
        await command('dispatch');
        return (
          (
            await pool.query(
              "SELECT id FROM notification_outbox WHERE message_id=ANY($1::uuid[]) AND status='completed'",
              [ids],
            )
          ).rowCount === 30
        );
      });
      await command('pause');
      evidence.checks.push(
        '30 accepted commands: dispatcher enqueues only 25 per batch; held worker shows exactly 4 concurrent durable claims; all 30 complete',
      );
    });
    it('notification work rechecks recipient sessions and current membership', async () => {
      const unrelated = await register();
      const stranger = await connect(unrelated);
      const leaked: string[] = [];
      stranger.on('message:new', (m: { id: string }) => leaked.push(m.id));
      const recipientMessages: string[] = [];
      recipientSocket.on('message:new', (m: { id: string }) =>
        recipientMessages.push(m.id),
      );
      await pool.query("DELETE FROM user_sessions WHERE sess->>'userId'=$1", [
        recipient.id,
      ]);
      const ack = await accept();
      await command('dispatch');
      await command('resume');
      await completed(ack.message.id);
      expect(recipientSocket.connected).toBe(false);
      expect(recipientMessages).not.toContain(ack.message.id);
      expect(leaked).toEqual([]);
      await command('pause');
      evidence.checks.push(
        'notification consumer excludes unrelated membership and rejects revoked receive sessions before emit',
      );
    });
  },
);
