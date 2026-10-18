import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Server } from 'socket.io';
import bcrypt from 'bcrypt';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Opt in with a disposable database; CI runs this before browser E2E tests.
// oxlint-disable-next-line node/no-process-env -- Read the opt-in test DB before app env validation and before hooks stub DATABASE_URL.
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
const migrationsFolder = fileURLToPath(
  new URL('../../../drizzle/', import.meta.url),
);
const password = 'day16-correct-horse-battery-staple';
const keyBundle = {
  publicKey: 'client-generated-public-key',
  wrappedPrivateKey: {
    ciphertext: 'wrapped-only',
    salt: 'salt',
    nonce: 'nonce',
  },
};

let app: FastifyInstance;
let io: Server;
let pool: Pool;
let sessionStore: typeof import('../../db/session').sessionStore;
const userIds: string[] = [];
const sessionIds: string[] = [];

function registerSessionHooks() {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl!);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(
      'SESSION_SECRET',
      'day16-local-test-secret-at-least-32-characters',
    );
    vi.stubEnv('CLIENT_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('BACKEND_PORT', '3001');
    ({ pool } = await import('../../db'));
    await migrate(drizzle(pool), { migrationsFolder });
    ({ sessionStore } = await import('../../db/session'));
    ({ app, io } = await (await import('../../app')).buildApp());
  }, 30_000);

  afterAll(async () => {
    if (io) await new Promise<void>((resolve) => io.close(() => resolve()));
    if (app) await app.close();
    if (pool) {
      await pool.query(
        'DELETE FROM user_sessions WHERE sid = ANY($1::varchar[])',
        [sessionIds],
      );
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        userIds,
      ]);
    }
    sessionStore?.close();
    if (pool) await pool.end();
    vi.unstubAllEnvs();
  });
}

function responseCookie(response: {
  cookies: { name: string; value: string }[];
}) {
  const cookie = [...response.cookies]
    .reverse()
    .find((item) => item.name === 'sessionId');
  expect(cookie).toBeDefined();
  const unsigned = app.unsignCookie(decodeURIComponent(cookie!.value));
  expect(unsigned.valid).toBe(true);
  sessionIds.push(unsigned.value!);
  return { header: `sessionId=${cookie!.value}`, sid: unsigned.value! };
}

async function seedSession(userId?: string) {
  const sid = randomUUID();
  sessionIds.push(sid);
  const expires = new Date(Date.now() + 60_000);
  await pool.query(
    'INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2::json, $3)',
    [
      sid,
      JSON.stringify({
        cookie: {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
          expires: expires.toISOString(),
          originalMaxAge: 60_000,
        },
        preAuthMarker: 'must-not-survive-rotation',
        ...(userId ? { userId } : {}),
      }),
      expires,
    ],
  );
  return {
    sid,
    header: `sessionId=${encodeURIComponent(app.signCookie(sid))}`,
  };
}

async function register() {
  const username = `d16_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password, ...keyBundle },
  });
  expect(response.statusCode).toBe(201);
  const user = response.json<{ id: string }>();
  userIds.push(user.id);
  return { id: user.id, username, cookie: responseCookie(response) };
}

async function expectRotation(
  old: { sid: string; header: string },
  response: Awaited<ReturnType<FastifyInstance['inject']>>,
  userId: string,
) {
  const fresh = responseCookie(response);
  expect(fresh.sid).not.toBe(old.sid);
  const oldRow = await pool.query(
    'SELECT sid FROM user_sessions WHERE sid = $1',
    [old.sid],
  );
  expect(oldRow.rowCount).toBe(0);
  const newRow = await pool.query(
    'SELECT sess FROM user_sessions WHERE sid = $1',
    [fresh.sid],
  );
  expect(newRow.rows[0].sess.userId).toBe(userId);
  expect(newRow.rows[0].sess.preAuthMarker).toBeUndefined();
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: old.header },
      })
    ).statusCode,
  ).toBe(401);
  const me = await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { cookie: fresh.header },
  });
  expect(me.statusCode).toBe(200);
  expect(me.json().id).toBe(userId);
  const setCookie = response.headers['set-cookie'];
  const cookieHeaders = Array.isArray(setCookie)
    ? setCookie.join(';')
    : setCookie;
  expect(cookieHeaders).toContain('HttpOnly');
  expect(cookieHeaders).toContain('SameSite=Lax');
}

function readStoredSession(store: typeof sessionStore, sid: string) {
  return new Promise<unknown>((resolve, reject) => {
    store.get(sid, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function migrationTests() {
  it('migrates sid/sess/expire, primary key and expiry index, and can rerun migrations', async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    const columns =
      await pool.query(`SELECT column_name, data_type, is_nullable, datetime_precision
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_sessions'
    ORDER BY ordinal_position`);
    expect(columns.rows).toEqual([
      expect.objectContaining({
        column_name: 'sid',
        data_type: 'character varying',
        is_nullable: 'NO',
      }),
      expect.objectContaining({
        column_name: 'sess',
        data_type: 'json',
        is_nullable: 'NO',
      }),
      expect.objectContaining({
        column_name: 'expire',
        data_type: 'timestamp without time zone',
        is_nullable: 'NO',
        datetime_precision: 6,
      }),
    ]);
    const indexes = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'user_sessions'",
    );
    expect(indexes.rows).toEqual(
      expect.arrayContaining([
        { indexdef: expect.stringMatching(/UNIQUE INDEX .*\(sid\)/) },
        { indexdef: expect.stringMatching(/INDEX .*\(expire\)/) },
      ]),
    );
  });

  it('adopts a boot-created table without losing sessions or duplicating the expiry index', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const schema = `day16_${randomUUID().replaceAll('-', '')}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(
        'CREATE TABLE user_sessions (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL)',
      );
      await client.query(
        'CREATE INDEX "IDX_session_expire" ON user_sessions (expire)',
      );
      await client.query(
        "INSERT INTO user_sessions VALUES ('existing-session', '{}', now() + interval '1 day')",
      );
      const migration = await readFile(
        `${migrationsFolder}/0003_user_sessions.sql`,
        'utf8',
      );
      await client.query(migration);
      expect(
        (await client.query('SELECT sid FROM user_sessions')).rows,
      ).toEqual([{ sid: 'existing-session' }]);
      const indexes = await client.query(
        'SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2',
        [schema, 'user_sessions'],
      );
      expect(
        indexes.rows.filter((row) => row.indexdef.includes('(expire)')),
      ).toHaveLength(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('fails on a missing session table instead of creating it at runtime', async () => {
    const runtimeConfig = await readFile(
      new URL('../../db/session.ts', import.meta.url),
      'utf8',
    );
    expect(runtimeConfig).toMatch(/createTableIfMissing:\s*false/);
    const client = await pool.connect();
    const schema = `day16_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      // No table in this schema: the store must fail, not silently create it.
      const PgSession = (await import('connect-pg-simple')).default(
        (await import('express-session')).default,
      );
      const missingTableStore = new PgSession({
        pool: client as unknown as Pool,
        schemaName: schema,
        tableName: 'user_sessions',
        createTableIfMissing: false,
        pruneSessionInterval: false,
      });
      try {
        await expect(
          readStoredSession(missingTableStore, 'missing'),
        ).rejects.toMatchObject({ code: '42P01' });
      } finally {
        missingTableStore.close();
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
}

function rotationTests() {
  it('rotates a persisted anonymous session on registration and kills its old cookie', async () => {
    const old = await seedSession();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: old.header },
      payload: {
        username: `d16_${randomUUID().slice(0, 20)}`,
        password,
        ...keyBundle,
      },
    });
    expect(response.statusCode).toBe(201);
    const { id } = response.json<{ id: string }>();
    userIds.push(id);
    await expectRotation(old, response, id);
  });

  it('rotates an existing authenticated session on login and kills its old cookie', async () => {
    const user = await register();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie: user.cookie.header },
      payload: { username: user.username, password },
    });
    expect(response.statusCode).toBe(200);
    await expectRotation(user.cookie, response, user.id);
    expect(response.json().wrappedPrivateKey).toEqual(
      keyBundle.wrappedPrivateKey,
    );
    expect(response.json().publicKey).toBe(keyBundle.publicKey);
  });

  it('rotates a persisted anonymous session on login', async () => {
    const user = await register();
    const old = await seedSession();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie: old.header },
      payload: { username: user.username, password },
    });
    expect(response.statusCode).toBe(200);
    await expectRotation(old, response, user.id);
  });

  it('does not grant authority or rotate the session on invalid credentials', async () => {
    const user = await register();
    const old = await seedSession();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie: old.header },
      payload: { username: user.username, password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
    const row = await pool.query(
      'SELECT sess FROM user_sessions WHERE sid = $1',
      [old.sid],
    );
    expect(row.rows[0].sess.userId).toBeUndefined();
  });
}

function lifecycleTests() {
  it('destroys a deleted user session, clears its cookie, and returns 401 on replay', async () => {
    const user = await register();
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: user.cookie.header },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Not authenticated',
    });
    expect(
      (
        await pool.query('SELECT sid FROM user_sessions WHERE sid = $1', [
          user.cookie.sid,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      response.cookies.find((cookie) => cookie.name === 'sessionId')?.value,
    ).toBe('');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/auth/me',
          headers: { cookie: user.cookie.header },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('keeps password verification on bcrypt cost 12 and stores only the wrapped key bundle', async () => {
    const user = await register();
    const {
      rows: [row],
    } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      user.id,
    ]);
    expect(bcrypt.getRounds(row.password_hash)).toBe(12);
    await expect(bcrypt.compare(password, row.password_hash)).resolves.toBe(
      true,
    );
    await expect(
      bcrypt.compare('wrong-password', row.password_hash),
    ).resolves.toBe(false);
    const {
      rows: [key],
    } = await pool.query(
      'SELECT public_key, wrapped_private_key FROM user_keys WHERE user_id = $1',
      [user.id],
    );
    expect(JSON.parse(key.wrapped_private_key)).toEqual(
      keyBundle.wrappedPrivateKey,
    );
    expect(key.public_key).toBe(keyBundle.publicKey);
  });
}

describe.skipIf(!databaseUrl)(
  'session authentication (real PostgreSQL)',
  () => {
    registerSessionHooks();
    migrationTests();
    rotationTests();
    lifecycleTests();
  },
);
