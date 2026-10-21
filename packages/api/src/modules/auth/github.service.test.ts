import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { createGitHubFlow, loadGitHubUserId } from './github.service';

const testEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  GITHUB_CLIENT_ID: 'test-client',
  GITHUB_CLIENT_SECRET: 'test-secret-not-real' as string | undefined,
  GITHUB_REDIRECT_URI: 'http://localhost:3001/auth/github/callback',
}));
vi.mock(import('../../config/env'), () => ({ env: testEnv as typeof env }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GitHub OAuth protocol', () => {
  it('uses independent random state/verifier and S256, never implicit or a token in the URL', () => {
    const flow = createGitHubFlow();
    const params = new URL(flow.url).searchParams;
    expect(flow.state).toMatch(/^[\w-]{43}$/);
    expect(flow.verifier).toMatch(/^[\w-]{43}$/);
    expect(flow.state).not.toBe(flow.verifier);
    expect(createGitHubFlow().state).not.toBe(flow.state);
    expect(params.get('client_id')).toBe('test-client');
    expect(params.get('redirect_uri')).toBe(env.GITHUB_REDIRECT_URI);
    expect(params.get('scope')).toBe('read:user');
    expect(params.get('state')).toBe(flow.state);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBe(
      createHash('sha256').update(flow.verifier).digest('base64url'),
    );
    expect(params.has('response_type')).toBe(false);
    expect(flow.url).not.toContain(flow.verifier);
    expect(flow.url).not.toContain('test-secret');
    expect(params.has('access_token')).toBe(false);
  });

  it('sends secret and verifier only in the back-channel POST, then drops the bearer token after /user', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'provider-token', token_type: 'bearer' }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 123456,
          login: 'mutable-name',
          email: 'not-an-identity@example.com',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      loadGitHubUserId('one-time-code', 'server-only-verifier'),
    ).resolves.toBe('123456');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body)).toEqual({
      client_id: 'test-client',
      client_secret: 'test-secret-not-real',
      redirect_uri: env.GITHUB_REDIRECT_URI,
      code: 'one-time-code',
      code_verifier: 'server-only-verifier',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/user');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer provider-token',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      body: {
        error: 'bad_verification_code',
        error_description: 'sensitive-upstream-data',
      },
      status: 200,
    },
    { body: { access_token: 'secret', token_type: 'bearer' }, status: 500 },
    { body: { access_token: 'secret', token_type: 'mac' }, status: 200 },
  ])(
    'fails closed on token exchange failure without exposing provider data ($status)',
    async ({ body, status }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json(body, { status })),
      );
      await expect(loadGitHubUserId('code', 'verifier')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'GitHub authentication failed; start sign-in again',
      });
    },
  );

  it.each([
    { id: 'not-numeric' },
    { id: -1 },
    { id: 1.5 },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    {},
  ])('rejects malformed stable identity %j', async (identity) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ access_token: 'secret', token_type: 'bearer' }),
        )
        .mockResolvedValueOnce(Response.json(identity)),
    );
    await expect(loadGitHubUserId('code', 'verifier')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('sanitizes network failures and user-endpoint failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('client_secret=do-not-leak')),
    );
    await expect(loadGitHubUserId('code', 'verifier')).rejects.toThrow(
      'GitHub authentication failed',
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ access_token: 'secret', token_type: 'bearer' }),
        )
        .mockResolvedValueOnce(
          Response.json({ message: 'secret' }, { status: 401 }),
        ),
    );
    await expect(loadGitHubUserId('code', 'verifier')).rejects.toThrow(
      'GitHub authentication failed',
    );
  });

  it('fails closed without config or on a non-HTTPS production callback', () => {
    const original = env.GITHUB_CLIENT_SECRET;
    testEnv.GITHUB_CLIENT_SECRET = undefined;
    expect(createGitHubFlow).toThrow('not configured');
    testEnv.GITHUB_CLIENT_SECRET = original;
    testEnv.NODE_ENV = 'production';
    expect(createGitHubFlow).toThrow('HTTPS');
    testEnv.NODE_ENV = 'test';
  });
});
