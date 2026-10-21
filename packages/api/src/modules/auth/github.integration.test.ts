import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Server } from 'socket.io';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  afterAll,
  beforeAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// oxlint-disable-next-line node/no-process-env -- opt-in disposable database.
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
let app: FastifyInstance;
let io: Server;
let pool: Pool;
let sessionStore: typeof import('../../db/session').sessionStore;
const userIds: string[] = [];
const sessionIds: string[] = [];
const conversationIds: string[] = [];
const mockFetch = vi.fn();
const password = 'day17-correct-horse-battery-staple';
const keyBundle = {
  publicKey: 'client-public-key',
  wrappedPrivateKey: {
    ciphertext: 'wrapped-only',
    salt: 'salt',
    nonce: 'nonce',
  },
};

function cookieFrom(response: { cookies: { name: string; value: string }[] }) {
  const cookie = [...response.cookies]
    .reverse()
    .find((item) => item.name === 'sessionId');
  expect(cookie).toBeDefined();
  const unsigned = app.unsignCookie(decodeURIComponent(cookie!.value));
  expect(unsigned.valid).toBe(true);
  sessionIds.push(unsigned.value!);
  return { sid: unsigned.value!, header: `sessionId=${cookie!.value}` };
}
async function register() {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username: `d17_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      password,
      ...keyBundle,
    },
  });
  expect(response.statusCode).toBe(201);
  const { id } = response.json<{ id: string }>();
  userIds.push(id);
  return { id, cookie: cookieFrom(response) };
}
async function start(cookie?: string, link = false) {
  const response = await app.inject({
    method: link ? 'POST' : 'GET',
    url: link ? '/auth/github/link' : '/auth/github',
    headers: { ...(cookie ? { cookie } : {}), origin: 'http://localhost:3000' },
  });
  expect(response.statusCode).toBe(link ? 200 : 302);
  const url = new URL(
    link ? response.json().authorizeUrl : response.headers.location!,
  );
  const state = url.searchParams.get('state')!;
  const sessionCookie = cookieFrom(response);
  return { response, url, state, cookie: sessionCookie };
}
function provider(id: number) {
  mockFetch
    .mockResolvedValueOnce(
      Response.json({
        access_token: 'github-test-token',
        token_type: 'bearer',
      }),
    )
    .mockResolvedValueOnce(Response.json({ id, login: 'mutable-name' }));
}
function callback(
  flow: Awaited<ReturnType<typeof start>>,
  query = `code=one-time-code&state=${flow.state}`,
) {
  return app.inject({
    method: 'GET',
    url: `/auth/github/callback?${query}`,
    headers: { cookie: flow.cookie.header },
  });
}
function me(cookie: string) {
  return app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
}

function registerGitHubHooks() {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl!);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SESSION_SECRET', 'day17-test-secret-at-least-32-characters');
    vi.stubEnv('CLIENT_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('BACKEND_PORT', '3001');
    vi.stubEnv('GITHUB_CLIENT_ID', 'test-client');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-secret-not-real');
    vi.stubEnv(
      'GITHUB_REDIRECT_URI',
      'http://localhost:3001/auth/github/callback',
    );
    ({ pool } = await import('../../db'));
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(
        new URL('../../../drizzle/', import.meta.url),
      ),
    });
    ({ sessionStore } = await import('../../db/session'));
    ({ app, io } = await (await import('../../app')).buildApp());
    vi.stubGlobal('fetch', mockFetch);
  }, 30_000);
  afterEach(() => {
    mockFetch.mockReset();
  });
  afterAll(async () => {
    if (io) await new Promise<void>((resolve) => io.close(() => resolve()));
    if (app) await app.close();
    if (pool) {
      await pool.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [
        conversationIds,
      ]);
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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
}

function stateValidationTests() {
  it('persists state/verifier only server-side and emits S256 with read:user only', async () => {
    const flow = await start();
    const {
      rows: [attempt],
    } = await pool.query(
      'SELECT * FROM github_oauth_attempts WHERE session_id = $1',
      [flow.cookie.sid],
    );
    expect(attempt.state).toBe(flow.state);
    expect(flow.url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(attempt.verifier).digest('base64url'),
    );
    expect(flow.url.searchParams.get('scope')).toBe('read:user');
    expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(
      flow.response.body + JSON.stringify(flow.response.headers),
    ).not.toContain(attempt.verifier);
    expect(
      flow.response.body + JSON.stringify(flow.response.headers),
    ).not.toContain('test-secret-not-real');
    expect(flow.response.headers['cache-control']).toBe('no-store');
    expect(flow.response.headers['referrer-policy']).toBe('no-referrer');
  });

  it.each([
    'code=code',
    'code=code&state=wrong',
    'code=code&state=%C3%A9',
    'code=code&state=x&state=y',
  ])(
    'rejects malformed/missing/mismatched state and consumes the attempt: %s',
    async (query) => {
      const flow = await start();
      const response = await callback(flow, query);
      expect(response.statusCode).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
      expect((await callback(flow)).statusCode).toBe(400);
      expect((await me(flow.cookie.header)).statusCode).toBe(401);
    },
  );

  it('binds state to the initiating session, never to just the query', async () => {
    const a = await start();
    const b = await start();
    expect((await callback(b, `code=code&state=${a.state}`)).statusCode).toBe(
      400,
    );
    expect(mockFetch).not.toHaveBeenCalled();
    // The legitimate flow is still pending in its own session.
    expect(
      (
        await pool.query(
          'SELECT state FROM github_oauth_attempts WHERE session_id=$1',
          [a.cookie.sid],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('refuses expired, denied, and code-less callbacks without granting authority', async () => {
    const expired = await start();
    await pool.query(
      "UPDATE github_oauth_attempts SET expires_at=now()-interval '1 second' WHERE session_id=$1",
      [expired.cookie.sid],
    );
    expect((await callback(expired)).statusCode).toBe(400);
    const denied = await start();
    expect(
      (await callback(denied, `error=access_denied&state=${denied.state}`))
        .statusCode,
    ).toBe(401);
    expect((await callback(denied)).statusCode).toBe(400);
    const noCode = await start();
    expect((await callback(noCode, `state=${noCode.state}`)).statusCode).toBe(
      400,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses unknown identities with instructions and creates neither user nor authenticated session', async () => {
    const flow = await start();
    provider(910000001);
    const before = (await pool.query('SELECT count(*) FROM users')).rows[0]
      .count;
    const response = await callback(flow);
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain('not linked');
    expect((await me(flow.cookie.header)).statusCode).toBe(401);
    expect((await pool.query('SELECT count(*) FROM users')).rows[0].count).toBe(
      before,
    );
    expect((await callback(flow)).statusCode).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
}

function linkingTests() {
  it('requires authentication and app Origin for explicit linking', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/github/link',
          headers: { origin: 'http://localhost:3000' },
        })
      ).statusCode,
    ).toBe(401);
    const user = await register();
    const missingOrigin = await app.inject({
      method: 'POST',
      url: '/auth/github/link',
      headers: { cookie: user.cookie.header },
    });
    expect(missingOrigin.statusCode).toBe(400);
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/auth/github/link',
      headers: { cookie: user.cookie.header, origin: 'https://evil.example' },
    });
    expect(wrongOrigin.statusCode).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('links an existing user, then signs in using only stable GitHub id; rotates/deletes old sessions and drops token/verifier', async () => {
    const user = await register();
    const linkFlow = await start(user.cookie.header, true);
    provider(910000002);
    const linked = await callback(linkFlow);
    expect(linked.statusCode).toBe(302);
    expect((await me(user.cookie.header)).statusCode).toBe(401);
    const linkedCookie = cookieFrom(linked);
    expect(linkedCookie.sid).not.toBe(user.cookie.sid);
    expect((await me(linkedCookie.header)).json().id).toBe(user.id);

    const flow = await start();
    provider(910000002);
    const response = await callback(flow);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:3000/chat');
    const fresh = cookieFrom(response);
    expect(fresh.sid).not.toBe(flow.cookie.sid);
    expect((await me(fresh.header)).json().id).toBe(user.id);
    expect((await me(flow.cookie.header)).statusCode).toBe(401);
    expect(
      (
        await pool.query('SELECT sid FROM user_sessions WHERE sid=$1', [
          flow.cookie.sid,
        ])
      ).rowCount,
    ).toBe(0);
    const session = (
      await pool.query('SELECT sess FROM user_sessions WHERE sid=$1', [
        fresh.sid,
      ])
    ).rows[0].sess;
    expect(session.userId).toBe(user.id);
    expect(
      JSON.stringify(session) +
        JSON.stringify(response.headers) +
        response.body,
    ).not.toMatch(/github-test-token|test-secret-not-real|code_verifier/);
    expect(
      (
        await pool.query(
          'SELECT * FROM github_oauth_attempts WHERE session_id=$1',
          [flow.cookie.sid],
        )
      ).rowCount,
    ).toBe(0);
    const bundle = await app.inject({
      method: 'GET',
      url: '/auth/key-bundle',
      headers: { cookie: fresh.header },
    });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.json()).toEqual(keyBundle);
    expect(
      (await app.inject({ method: 'GET', url: '/auth/key-bundle' })).statusCode,
    ).toBe(401);
    // Existing membership authorization rejects a real conversation owned by others.
    const outsiderA = await register();
    const outsiderB = await register();
    const conversation = await app.inject({
      method: 'POST',
      url: '/chat/conversations',
      headers: { cookie: outsiderA.cookie.header },
      payload: { memberId: outsiderB.id },
    });
    expect(conversation.statusCode).toBe(201);
    const conversationId = conversation.json().id;
    conversationIds.push(conversationId);
    const history = await app.inject({
      method: 'GET',
      url: `/chat/messages?conversationId=${conversationId}`,
      headers: { cookie: fresh.header },
    });
    expect(history.statusCode).toBe(404);
    expect(history.json().code).toBe('CONVERSATION_NOT_FOUND');
  });
}

function identityLifecycleTests() {
  it('does not implicitly link a GitHub identity during normal sign-in, even with an existing session', async () => {
    const user = await register();
    const flow = await start(user.cookie.header);
    provider(910000003);
    expect((await callback(flow)).statusCode).toBe(401);
    expect(
      (
        await pool.query(
          'SELECT * FROM github_identities WHERE github_user_id=$1',
          ['910000003'],
        )
      ).rowCount,
    ).toBe(0);
    expect((await me(user.cookie.header)).json().id).toBe(user.id);
  });

  it('prevents linking a provider identity owned by another Cipher user', async () => {
    const a = await register();
    const b = await register();
    const first = await start(a.cookie.header, true);
    provider(910000004);
    expect((await callback(first)).statusCode).toBe(302);
    const second = await start(b.cookie.header, true);
    provider(910000004);
    expect((await callback(second)).statusCode).toBe(400);
    expect(
      (
        await pool.query(
          'SELECT user_id FROM github_identities WHERE github_user_id=$1',
          ['910000004'],
        )
      ).rows[0].user_id,
    ).toBe(a.id);
  });

  it('fails closed when provider exchange fails and does not retry a consumed state', async () => {
    const flow = await start();
    mockFetch.mockResolvedValueOnce(
      Response.json({ error: 'bad_verification_code' }),
    );
    expect((await callback(flow)).statusCode).toBe(401);
    expect((await callback(flow)).statusCode).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((await me(flow.cookie.header)).statusCode).toBe(401);
  });

  it('atomically consumes state for concurrent callbacks (exactly one provider exchange)', async () => {
    const user = await register();
    const flow = await start(user.cookie.header, true);
    provider(910000005);
    const results = await Promise.all([callback(flow), callback(flow)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([302, 400]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const success = results.find((r) => r.statusCode === 302)!;
    const fresh = cookieFrom(success);
    expect((await me(fresh.header)).json().id).toBe(user.id);
  });
}

describe.skipIf(!databaseUrl)(
  'GitHub OAuth (real PostgreSQL + session plugin; mocked provider)',
  () => {
    registerGitHubHooks();
    stateValidationTests();
    linkingTests();
    identityLifecycleTests();
  },
);
