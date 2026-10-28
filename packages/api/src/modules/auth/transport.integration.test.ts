/* oxlint-disable max-lines-per-function, no-await-in-loop -- This bounded live fixture deliberately sequences setup and expiry checks. */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// oxlint-disable-next-line node/no-process-env -- opt-in disposable database
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('transport authority (real PostgreSQL)', () => {
  let app: Awaited<ReturnType<typeof import('../../app').buildApp>>['app'];
  let io: Awaited<ReturnType<typeof import('../../app').buildApp>>['io'];
  let pool: typeof import('../../db').pool;
  let store: typeof import('../../db/session').sessionStore;
  let url: string;
  const users: string[] = [];
  const clients: Socket[] = [];
  const origin = 'http://localhost:3000';
  const password = 'transport-regression-password';
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl!);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(
      'SESSION_SECRET',
      'transport-test-secret-at-least-32-characters',
    );
    vi.stubEnv('CLIENT_ORIGIN', origin);
    vi.stubEnv('BACKEND_PORT', '3001');
    ({ pool } = await import('../../db'));
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(
        new URL('../../../drizzle/', import.meta.url),
      ),
    });
    ({ sessionStore: store } = await import('../../db/session'));
    ({ app, io } = await (await import('../../app')).buildApp());
    url = await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => {
    for (const client of clients) client.disconnect();
    if (io) await new Promise<void>((resolve) => io.close(() => resolve()));
    if (app) await app.close();
    if (pool) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    }
    store?.close();
    if (pool) await pool.end();
    vi.unstubAllEnvs();
  });
  async function register() {
    const username = `transport_${randomUUID().slice(0, 12)}`;
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        password,
        publicKey: 'test',
        wrappedPrivateKey: { ciphertext: 'test', salt: 'test', nonce: 'test' },
      },
    });
    expect(response.statusCode).toBe(201);
    const cookie = response.cookies
      .filter((c) => c.name === 'sessionId')
      .at(-1)!;
    const id = response.json().id as string;
    users.push(id);
    return {
      id,
      username,
      cookie: `sessionId=${cookie.value}`,
      sid: app.unsignCookie(decodeURIComponent(cookie.value)).value!,
    };
  }
  function open(cookie: string, source: string | null = origin) {
    const client = connect(url, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { cookie, ...(source ? { origin: source } : {}) },
    });
    clients.push(client);
    return client;
  }
  async function ready(client: Socket) {
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    // Wait for the async server bootstrap, not an arbitrary message delay.
    for (let i = 0; i < 100; i++) {
      if (io.sockets.sockets.get(client.id!)?.listenerCount('message:send'))
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('socket handlers were not installed');
  }
  it('revokes live sockets on logout and clears the cookie', async () => {
    const user = await register();
    const client = open(user.cookie);
    await ready(client);
    const disconnected = new Promise((resolve) =>
      client.once('disconnect', resolve),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: user.cookie, origin },
    });
    expect(response.statusCode).toBe(200);
    await disconnected;
    expect(client.connected).toBe(false);
    expect(response.cookies.find((c) => c.name === 'sessionId')?.value).toBe(
      '',
    );
    expect(
      (await app.inject({ url: '/auth/me', headers: { cookie: user.cookie } }))
        .statusCode,
    ).toBe(401);
  });
  async function withPausedSessionSave(
    cookie: string,
    action: () => Promise<void>,
  ) {
    const originalSet = store.set.bind(store);
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(store, 'set')
      .mockImplementationOnce((sid, value, done) => {
        entered();
        void pending.then(() => originalSet(sid, value, done));
      });
    // Start a real authenticated response, paused just before its rolling save.
    const request = app
      .inject({ url: '/auth/me', headers: { cookie } })
      .then((response) => response);
    try {
      await started;
      await action();
    } finally {
      release();
      await request;
      spy.mockRestore();
    }
  }
  async function expectRevoked(cookie: string, sid: string) {
    expect(
      (await app.inject({ url: '/auth/me', headers: { cookie } })).statusCode,
    ).toBe(401);
    expect(
      (await pool.query('SELECT sid FROM user_sessions WHERE sid=$1', [sid]))
        .rows,
    ).toEqual([]);
  }
  it('a response completing after logout cannot resurrect its session', async () => {
    const user = await register();
    await withPausedSessionSave(user.cookie, async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie: user.cookie, origin },
      });
      expect(response.statusCode).toBe(200);
      await expectRevoked(user.cookie, user.sid);
    });
    await expectRevoked(user.cookie, user.sid);
  });
  it('a response completing after login rotation cannot restore the old session', async () => {
    const user = await register();
    await withPausedSessionSave(user.cookie, async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { cookie: user.cookie, origin },
        payload: { username: user.username, password },
      });
      expect(response.statusCode).toBe(200);
      const cookie = response.cookies
        .filter((value) => value.name === 'sessionId')
        .at(-1)!;
      expect(
        (
          await app.inject({
            url: '/auth/me',
            headers: { cookie: `sessionId=${cookie.value}` },
          })
        ).statusCode,
      ).toBe(200);
      await expectRevoked(user.cookie, user.sid);
    });
    await expectRevoked(user.cookie, user.sid);
  });
  it('a stale explicit save cannot restore destroyed session authority', async () => {
    const user = await register();
    const snapshot = await new Promise<import('express-session').SessionData>(
      (resolve, reject) => {
        store.get(user.sid, (error, value) =>
          error ? reject(error) : resolve(value!),
        );
      },
    );
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: user.cookie, origin },
    });
    expect(response.statusCode).toBe(200);
    await new Promise<void>((resolve, reject) => {
      store.set(
        user.sid,
        Object.assign({}, snapshot, {
          staleUpdate: 'must-not-restore-authority',
        }),
        (error) => (error ? reject(error) : resolve()),
      );
    });
    await expectRevoked(user.cookie, user.sid);
  });
  it('valid authenticated reads still renew the rolling seven-day session', async () => {
    const user = await register();
    const { rows } = await pool.query(
      'SELECT sess FROM user_sessions WHERE sid=$1',
      [user.sid],
    );
    const earlierExpiry = new Date(Date.now() + 60_000);
    rows[0].sess.cookie.expires = earlierExpiry.toISOString();
    await pool.query(
      'UPDATE user_sessions SET sess=$2, expire=$3 WHERE sid=$1',
      [user.sid, rows[0].sess, earlierExpiry],
    );
    const response = await app.inject({
      url: '/auth/me',
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.cookies.some((value) => value.name === 'sessionId')).toBe(
      true,
    );
    const renewed = await pool.query(
      'SELECT expire FROM user_sessions WHERE sid=$1',
      [user.sid],
    );
    expect(renewed.rows[0].expire.getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 60 * 60 * 1000,
    );
  });
  it('rotating a login disconnects only the old session', async () => {
    const user = await register();
    const old = open(user.cookie);
    await ready(old);
    const gone = new Promise((resolve) => old.once('disconnect', resolve));
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie: user.cookie, origin },
      payload: { username: user.username, password },
    });
    expect(response.statusCode).toBe(200);
    await gone;
    expect(old.connected).toBe(false);
  });
  it('rejects untrusted and missing browser origins', async () => {
    const user = await register();
    for (const source of ['https://untrusted.example', null]) {
      const client = open(user.cookie, source);
      await new Promise((resolve) => client.once('connect_error', resolve));
      expect(client.connected).toBe(false);
    }
  });
  it('revalidates authority before a sensitive event', async () => {
    const user = await register();
    const client = open(user.cookie);
    await ready(client);
    await pool.query('DELETE FROM user_sessions WHERE sid=$1', [user.sid]);
    const gone = new Promise((resolve) => client.once('disconnect', resolve));
    client.emit('conversation:join', { conversationId: randomUUID() });
    await gone;
    expect(client.connected).toBe(false);
  });
  it('expires idle receive authority within the bounded check interval', async () => {
    const user = await register();
    const client = open(user.cookie);
    await ready(client);
    await pool.query(
      "UPDATE user_sessions SET expire=now()-interval '1 second' WHERE sid=$1",
      [user.sid],
    );
    await new Promise((resolve) => client.once('disconnect', resolve));
    expect(client.connected).toBe(false);
  }, 10_000);
  it('re-notifies a newly connected recipient after a post-insert failure and replay', async () => {
    const sender = await register();
    const recipient = await register();
    const recipientSocket = open(recipient.cookie);
    await ready(recipientSocket);
    const senderSocket = open(sender.cookie);
    await ready(senderSocket);
    const response = await app.inject({
      method: 'POST',
      url: '/chat/conversations',
      headers: { cookie: sender.cookie },
      payload: { memberId: recipient.id },
    });
    const conversationId = response.json().id;
    const { chatService } = await import('../chat/chat.service');
    const failure = vi
      .spyOn(chatService, 'getConversationMembers')
      .mockRejectedValueOnce(new Error('injected notification failure'));
    const command = {
      conversationId,
      clientMessageId: randomUUID(),
      ciphertext: 'synthetic',
      nonce: 'synthetic',
      algorithm: 'x25519-xsalsa20-poly1305',
    };
    const first = await senderSocket
      .timeout(2_000)
      .emitWithAck('message:send', command);
    expect(first.ok).toBe(false);
    const update = new Promise<any>((resolve) =>
      recipientSocket.once('conversation:updated', resolve),
    );
    const retried = await senderSocket
      .timeout(2_000)
      .emitWithAck('message:send', command);
    expect(retried.ok).toBe(true);
    expect(retried.replayed).toBe(true);
    expect((await update).message.id).toBe(retried.message.id);
    const rows = await pool.query(
      'SELECT id FROM messages WHERE sender_id=$1 AND client_message_id=$2',
      [sender.id, command.clientMessageId],
    );
    expect(rows.rowCount).toBe(1);
    failure.mockRestore();
  });
  it('does not cache auth responses and refuses cross-origin mutation', async () => {
    const response = await app.inject({ url: '/auth/config' });
    expect(response.headers['cache-control']).toBe('no-store');
    const rejected = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'x', password: 'x' },
    });
    expect(rejected.statusCode).toBe(400);
  });
});
