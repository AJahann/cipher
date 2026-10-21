import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';

vi.mock(import('../../config/env'), () => ({
  env: { NEXT_PUBLIC_API_URL: 'https://api.example.test' },
}));
afterEach(() => vi.unstubAllGlobals());

function freshResponse(_input: string, _init: RequestInit) {
  // Response bodies are consumable, so every request needs a fresh instance.
  return Promise.resolve(Response.json({ ok: true }));
}

function stubFetch() {
  const fetchMock = vi.fn(freshResponse);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiFetch request headers', () => {
  it.each(['/auth/github/link', '/auth/logout'])(
    'does not advertise JSON for a bodyless POST to %s',
    async (path) => {
      const fetchMock = stubFetch();
      await expect(apiFetch(path, { method: 'POST' })).resolves.toEqual({
        ok: true,
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://api.example.test${path}`);
      expect(init.method).toBe('POST');
      expect(init.body).toBeUndefined();
      expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).has('content-type')).toBe(false);
    },
  );

  it('does not add content-type to GET or a null request body', async () => {
    const fetchMock = stubFetch();
    await apiFetch('/auth/me');
    await apiFetch('/auth/logout', { method: 'POST', body: null });
    expect(
      new Headers(fetchMock.mock.calls[0][1].headers).has('content-type'),
    ).toBe(false);
    expect(
      new Headers(fetchMock.mock.calls[1][1].headers).has('content-type'),
    ).toBe(false);
  });

  it('keeps JSON content-type for serialized request bodies', async () => {
    const fetchMock = stubFetch();
    const body = JSON.stringify({
      username: 'alice',
      password: 'test-only-password',
    });
    await apiFetch('/auth/login', { method: 'POST', body });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(body);
    expect(new Headers(init.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(init.credentials).toBe('include');
  });

  const headerCases: { name: string; createHeaders: () => HeadersInit }[] = [
    {
      name: 'record',
      createHeaders: () => ({
        'Content-Type': 'text/plain',
        'X-Request-Test': 'object',
      }),
    },
    {
      name: 'Headers',
      createHeaders: () =>
        new Headers({
          'Content-Type': 'text/plain',
          'X-Request-Test': 'headers',
        }),
    },
    {
      name: 'tuples',
      createHeaders: () => [
        ['Content-Type', 'text/plain'],
        ['X-Request-Test', 'tuple'],
      ],
    },
  ];
  it.each(headerCases)(
    'preserves explicit content type and custom headers ($name)',
    async ({ createHeaders }) => {
      const fetchMock = stubFetch();
      await apiFetch('/example', {
        method: 'POST',
        body: 'text',
        headers: createHeaders(),
      });
      const result = new Headers(fetchMock.mock.calls[0][1].headers);
      expect(result.get('content-type')).toBe('text/plain');
      expect(result.has('x-request-test')).toBe(true);
    },
  );

  it('does not label FormData as JSON or invent a multipart boundary', async () => {
    const fetchMock = stubFetch();
    const body = new FormData();
    body.set('example', 'value');
    await apiFetch('/example', { method: 'POST', body });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(body);
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });
});
