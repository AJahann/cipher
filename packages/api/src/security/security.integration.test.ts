/* oxlint-disable max-lines-per-function, no-await-in-loop -- Real sequential abuse windows and assertions over committed database effects. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { encodeCursor } from '../http/cursor';
import { HTTP_BODY_BYTES, SOCKET_PAYLOAD_BYTES } from './policy';

// oxlint-disable-next-line node/no-process-env -- Explicit disposable PostgreSQL opt-in.
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  'Day 21 real HTTP/socket security boundaries',
  () => {
    let app: Awaited<ReturnType<typeof import('../app').buildApp>>['app'];
    let io: Awaited<ReturnType<typeof import('../app').buildApp>>['io'];
    let pool: typeof import('../db').pool;
    let store: typeof import('../db/session').sessionStore;
    let service: typeof import('../modules/user/user.service').userService;
    let chat: typeof import('../modules/chat/chat.service').chatService;
    let Presence: typeof import('../redis/presence').Presence;
    let url: string;
    let now = Date.now();
    const origin = 'http://localhost:3000';
    const password = 'synthetic-day21-passphrase';
    const clients: Socket[] = [];
    const users: string[] = [];
    interface Account {
      id: string;
      username: string;
      cookie: string;
    }
    let a: Account;
    let b: Account;
    let c: Account;
    let secondCookie: string;
    let ab: string;
    let bc: string;
    const cookieFrom = (response: {
      cookies: { name: string; value: string }[];
    }) =>
      `sessionId=${response.cookies.filter((x) => x.name === 'sessionId').at(-1)!.value}`;
    async function register(): Promise<Account> {
      const username = `d21_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username,
          password,
          publicKey: 'synthetic-key',
          wrappedPrivateKey: {
            ciphertext: 'synthetic',
            salt: 'synthetic',
            nonce: 'synthetic',
          },
        },
      });
      expect(response.statusCode).toBe(201);
      const id = response.json().id as string;
      users.push(id);
      return { id, username, cookie: cookieFrom(response) };
    }
    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl!);
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv(
        'SESSION_SECRET',
        'synthetic-day21-session-signing-key-not-production',
      );
      vi.stubEnv('CLIENT_ORIGIN', origin);
      vi.stubEnv('BACKEND_PORT', '3001');
      vi.stubEnv('REDIS_URL', undefined);
      ({ pool } = await import('../db'));
      await migrate(drizzle(pool), {
        migrationsFolder: fileURLToPath(
          new URL('../../drizzle/', import.meta.url),
        ),
      });
      ({ sessionStore: store } = await import('../db/session'));
      ({ userService: service } = await import('../modules/user/user.service'));
      ({ chatService: chat } = await import('../modules/chat/chat.service'));
      ({ Presence } = await import('../redis/presence'));
      ({ app, io } = await (await import('../app')).buildApp(
        {},
        { now: () => now },
      ));
      url = await app.listen({ port: 0, host: '127.0.0.1' });
      a = await register();
      b = await register();
      c = await register();
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: a.username, password },
      });
      assert.equal(login.statusCode, 200);
      secondCookie = cookieFrom(login);
      ab = (await chat.getOrCreateDirectConversation(a.id, b.id)).conversation
        .id;
      bc = (await chat.getOrCreateDirectConversation(b.id, c.id)).conversation
        .id;
    });
    beforeEach(() => {
      now += 60_001;
    });
    afterEach(async () => {
      for (const client of clients.splice(0)) client.disconnect();
      vi.restoreAllMocks();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    afterAll(async () => {
      if (io) await new Promise<void>((resolve) => io.close(() => resolve()));
      if (app) await app.close();
      if (pool) {
        await pool.query(
          'DELETE FROM conversations WHERE id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ANY($1::uuid[]))',
          [users],
        );
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          users,
        ]);
      }
      store?.close();
      if (pool) await pool.end();
      vi.unstubAllEnvs();
    });
    function open(cookie?: string, source: string | null = origin) {
      const client = connect(url, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: {
          ...(cookie ? { cookie } : {}),
          ...(source === null ? {} : { origin: source }),
        },
      });
      clients.push(client);
      return client;
    }
    async function ready(client: Socket) {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });
      for (let i = 0; i < 100; i++) {
        if (io.sockets.sockets.get(client.id!)?.listenerCount('message:send'))
          return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('SOCKET_BOOTSTRAP_TIMEOUT');
    }
    const invalidCommand = {
      conversationId: 'bad',
      clientMessageId: 'bad',
      ciphertext: 'synthetic',
      nonce: 'synthetic',
      algorithm: 'synthetic',
    };
    const command = (conversationId = ab) => ({
      ...invalidCommand,
      conversationId,
      clientMessageId: randomUUID(),
    });
    async function effects() {
      const { rows } = await pool.query(`SELECT
      (SELECT count(*)::int FROM messages) AS messages,
      (SELECT count(*)::int FROM notification_outbox) AS intents,
      (SELECT count(*)::int FROM conversations) AS conversations,
      (SELECT count(*)::int FROM message_reads) AS reads`);
      return rows[0];
    }
    it('rejects password IP bursts before hashing/session reads and ignores spoofed forwarded IP', async () => {
      const work = vi.spyOn(service, 'register');
      for (let i = 0; i < 30; i++)
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/auth/register',
              payload: {},
              headers: { 'x-forwarded-for': `192.0.2.${i}` },
            })
          ).statusCode,
        ).toBe(400);
      const sessionRead = vi.spyOn(store, 'get');
      const blocked = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {},
        headers: { cookie: a.cookie, 'x-forwarded-for': '198.51.100.1' },
      });
      expect(blocked.statusCode).toBe(429);
      expect(sessionRead).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/auth/register',
            remoteAddress: '127.0.0.2',
            payload: {},
          })
        ).statusCode,
      ).toBe(400);
      now += 60_001;
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/auth/register',
            payload: {},
          })
        ).statusCode,
      ).toBe(400);
    });
    it('shares the HTTP read budget across routes and sessions, not across accounts', async () => {
      const routes = [
        '/users?limit=1',
        `/users/${b.id}/public-key`,
        '/chat/conversations',
        `/chat/messages?conversationId=${ab}&limit=1`,
        '/auth/me',
        '/auth/key-bundle',
      ];
      for (let i = 0; i < 180; i++) {
        const response = await app.inject({
          url: routes[i % routes.length],
          headers: { cookie: [secondCookie, a.cookie][i % 2] },
        });
        expect(response.statusCode).toBe(200);
      }
      const work = vi.spyOn(service, 'getPublicKey');
      const save = vi.spyOn(store, 'set');
      expect(
        (
          await app.inject({
            url: `/users/${b.id}/public-key`,
            headers: { cookie: a.cookie },
          })
        ).statusCode,
      ).toBe(429);
      expect(work).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            url: '/users?limit=1',
            headers: { cookie: b.cookie },
          })
        ).statusCode,
      ).toBe(200);
      now += 60_001;
      expect(
        (
          await app.inject({
            url: '/users?limit=1',
            headers: { cookie: secondCookie },
          })
        ).statusCode,
      ).toBe(200);
    });
    it('limits conversation creation before writes and permits an independent account/window', async () => {
      for (let i = 0; i < 20; i++)
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/chat/conversations',
              headers: { cookie: a.cookie },
              payload: { memberId: b.id },
            })
          ).statusCode,
        ).toBe(200);
      const before = await effects();
      const work = vi.spyOn(chat, 'getOrCreateDirectConversation');
      const save = vi.spyOn(store, 'set');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/chat/conversations',
            headers: { cookie: secondCookie },
            payload: { memberId: c.id },
          })
        ).statusCode,
      ).toBe(429);
      expect(work).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      await expect(effects()).resolves.toEqual(before);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/chat/conversations',
            headers: { cookie: b.cookie },
            payload: { memberId: a.id },
          })
        ).statusCode,
      ).toBe(200);
      now += 60_001;
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/chat/conversations',
            headers: { cookie: a.cookie },
            payload: { memberId: b.id },
          })
        ).statusCode,
      ).toBe(200);
    });
    it('actually refuses foreign/null Origin mutations before side effects; trusted and absent Origin work', async () => {
      const before = await effects();
      const lookup = vi.spyOn(store, 'get');
      const registration = vi.spyOn(service, 'register');
      const login = vi.spyOn(service, 'login');
      for (const source of ['https://untrusted.example', 'null', '']) {
        for (const path of [
          '/auth/register',
          '/auth/login',
          '/auth/logout',
          '/auth/github/link',
          '/chat/conversations',
        ]) {
          const response = await app.inject({
            method: 'POST',
            url: path,
            headers: { cookie: a.cookie, origin: source },
            payload: { memberId: c.id },
          });
          expect(response.statusCode).toBe(400);
          expect(response.json().code).toBe('BAD_REQUEST');
        }
      }
      await expect(effects()).resolves.toEqual(before);
      expect(lookup).not.toHaveBeenCalled();
      expect(registration).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      const trusted = await app.inject({
        method: 'POST',
        url: '/chat/conversations',
        headers: { cookie: a.cookie, origin },
        payload: { memberId: b.id },
      });
      expect(trusted.statusCode).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/chat/conversations',
            headers: { cookie: a.cookie },
            payload: { memberId: b.id },
          })
        ).statusCode,
      ).toBe(200);
    });
    it('rejects invalid/oversized HTTP input and unauthorized history without mutations', async () => {
      const before = await effects();
      for (const path of [
        '/users?limit=101',
        '/users/not-uuid/public-key',
        `/chat/messages?conversationId=${ab}&cursor=${'x'.repeat(513)}`,
      ])
        expect(
          (await app.inject({ url: path, headers: { cookie: a.cookie } }))
            .statusCode,
        ).toBe(400);
      expect(
        (
          await app.inject({
            url: `/chat/messages?conversationId=${bc}`,
            headers: { cookie: a.cookie },
          })
        ).statusCode,
      ).toBe(404);
      expect((await app.inject({ url: '/users' })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/chat/conversations',
            headers: { cookie: a.cookie },
            payload: { memberId: 'bad' },
          })
        ).statusCode,
      ).toBe(400);
      const hash = vi.spyOn(service, 'register');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/auth/register',
            payload: { padding: 'x'.repeat(HTTP_BODY_BYTES) },
          })
        ).statusCode,
      ).toBe(413);
      expect(hash).not.toHaveBeenCalled();
      await expect(effects()).resolves.toEqual(before);
    });
    it('shares socket event budget across tabs/reconnects, isolates accounts and recovers with no message/intent', async () => {
      const first = open(a.cookie);
      const second = open(secondCookie);
      await Promise.all([ready(first), ready(second)]);
      const before = await effects();
      for (let i = 0; i < 120; i++)
        expect(
          (
            await [second, first][i % 2]
              .timeout(2000)
              .emitWithAck('message:send', invalidCommand)
          ).error.code,
        ).toBe('VALIDATION_FAILED');
      expect(
        (await first.timeout(2000).emitWithAck('message:send', command())).error
          .code,
      ).toBe('RATE_LIMITED');
      first.disconnect();
      const reconnected = open(a.cookie);
      await ready(reconnected);
      expect(
        (await reconnected.timeout(2000).emitWithAck('message:send', command()))
          .error.code,
      ).toBe('RATE_LIMITED');
      const independent = open(b.cookie);
      await ready(independent);
      expect(
        (
          await independent
            .timeout(2000)
            .emitWithAck('message:send', invalidCommand)
        ).error.code,
      ).toBe('VALIDATION_FAILED');
      now += 10_001;
      expect(
        (
          await reconnected
            .timeout(2000)
            .emitWithAck('message:send', invalidCommand)
        ).error.code,
      ).toBe('VALIDATION_FAILED');
      await expect(effects()).resolves.toEqual(before);
    });
    it('rejects nonmember sends/reads/joins, invalid ciphertext and cross-conversation cursors with no rejected mutation effect', async () => {
      const client = open(a.cookie);
      await ready(client);
      const before = await effects();
      expect(
        (await client.timeout(2000).emitWithAck('message:send', command(bc)))
          .error.code,
      ).toBe('CONVERSATION_NOT_FOUND');
      expect(
        (
          await client.timeout(2000).emitWithAck('message:send', {
            ...command(),
            ciphertext: 'x'.repeat(65_537),
          })
        ).error.code,
      ).toBe('VALIDATION_FAILED');
      for (const [event, data] of [
        ['message:read', { conversationId: bc, messageId: randomUUID() }],
        ['conversation:join', { conversationId: bc }],
        ['typing:start', { conversationId: bc }],
      ] as const) {
        const error = new Promise<{ error: { code: string } }>((resolve) =>
          client.once('error', resolve),
        );
        client.emit(event, data);
        expect((await error).error.code).toBe('CONVERSATION_NOT_FOUND');
      }
      await expect(effects()).resolves.toEqual(before);
      const foreign = await chat.sendMessage({
        ...command(bc),
        senderId: b.id,
      });
      expect(
        (
          await app.inject({
            url: `/chat/messages?conversationId=${ab}&cursor=${encodeCursor('messages', foreign.message.id)}`,
            headers: { cookie: a.cookie },
          })
        ).statusCode,
      ).toBe(400);
    });
    it('does not treat a stale typing room as current membership authority', async () => {
      const sender = open(a.cookie);
      const peer = open(b.cookie);
      await Promise.all([ready(sender), ready(peer)]);
      const received = vi.fn();
      peer.on('typing:indicator', received);
      await pool.query(
        'DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
        [ab, a.id],
      );
      try {
        const error = new Promise<{ error: { code: string } }>((resolve) =>
          sender.once('error', resolve),
        );
        sender.emit('typing:start', { conversationId: ab });
        expect((await error).error.code).toBe('CONVERSATION_NOT_FOUND');
        expect(
          io.sockets.sockets.get(sender.id!)?.rooms.has(`conv:${ab}`),
        ).toBe(false);
        expect(received).not.toHaveBeenCalled();
      } finally {
        await pool.query(
          'INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2)',
          [ab, a.id],
        );
      }
    });
    it('enforces the transport byte ceiling before a message can be persisted', async () => {
      const client = open(a.cookie);
      await ready(client);
      const before = await effects();
      const disconnected = new Promise((resolve) =>
        client.once('disconnect', resolve),
      );
      client.emit(
        'message:send',
        { ...command(), ciphertext: 'x'.repeat(SOCKET_PAYLOAD_BYTES + 1) },
        () => {},
      );
      await disconnected;
      await expect(effects()).resolves.toEqual(before);
    });
    it('preserves permanent command replay/conflict semantics and one logical intent', async () => {
      const client = open(a.cookie);
      await ready(client);
      const payload = command();
      const before = await effects();
      const first = await client
        .timeout(2000)
        .emitWithAck('message:send', payload);
      const replay = await client
        .timeout(2000)
        .emitWithAck('message:send', payload);
      const conflict = await client
        .timeout(2000)
        .emitWithAck('message:send', { ...payload, ciphertext: 'changed' });
      expect(first.ok).toBe(true);
      expect(replay.replayed).toBe(true);
      expect(replay.message.id).toBe(first.message.id);
      expect(conflict.error.code).toBe('IDEMPOTENCY_CONFLICT');
      const after = await effects();
      expect(after.messages - before.messages).toBe(1);
      expect(after.intents - before.intents).toBe(1);
    });
    it('shares a separate presence-sync budget across tabs and recovers', async () => {
      const first = open(a.cookie);
      const second = open(secondCookie);
      await Promise.all([ready(first), ready(second)]);
      const work = vi.spyOn(Presence.prototype, 'sync');
      for (let i = 0; i < 10; i++) [second, first][i % 2].emit('presence:sync');
      await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(10));
      const error = new Promise<{ error: { code: string } }>((resolve) =>
        second.once('error', resolve),
      );
      second.emit('presence:sync');
      expect((await error).error.code).toBe('RATE_LIMITED');
      expect(work).toHaveBeenCalledTimes(10);
      now += 10_001;
      first.emit('presence:sync');
      await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(11));
    });
    it('applies a general early HTTP IP ceiling before authenticated session work', async () => {
      for (let i = 0; i < 300; i++)
        expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
      const lookup = vi.spyOn(store, 'get');
      expect(
        (await app.inject({ url: '/auth/me', headers: { cookie: a.cookie } }))
          .statusCode,
      ).toBe(429);
      expect(lookup).not.toHaveBeenCalled();
      now += 60_001;
      expect(
        (await app.inject({ url: '/auth/me', headers: { cookie: a.cookie } }))
          .statusCode,
      ).toBe(200);
    });
    it('limits initial Engine.IO handshakes before cookie lookup and recovers', async () => {
      for (let i = 0; i < 60; i++) {
        const anonymous = open();
        await new Promise((resolve) =>
          anonymous.once('connect_error', resolve),
        );
      }
      const lookup = vi.spyOn(store, 'get');
      const blocked = open(a.cookie);
      await new Promise((resolve) => blocked.once('connect_error', resolve));
      expect(blocked.connected).toBe(false);
      expect(lookup).not.toHaveBeenCalled();
      now += 60_001;
      const recovered = open(a.cookie);
      await ready(recovered);
      expect(recovered.connected).toBe(true);
    }, 15_000);
    it('refuses missing/foreign WebSocket Origin before session lookup', async () => {
      const lookup = vi.spyOn(store, 'get');
      for (const source of ['https://untrusted.example', null]) {
        const client = open(a.cookie, source);
        await new Promise((resolve) => client.once('connect_error', resolve));
        expect(client.connected).toBe(false);
      }
      expect(lookup).not.toHaveBeenCalled();
    });
  },
);
