import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { ME_PATH, stubUser } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { useAuthConfig, useGitHubLinkStatus, useMe } from './use-user';
import { makeClient, makeWrapper } from '../../../test/helpers';

describe(useMe, () => {
  it('returns the user on 200', async () => {
    const { result } = renderHook(() => useMe(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stubUser);
  });

  it('isError after 401 — exactly one GET, no retries', async () => {
    let hits = 0;
    server.use(
      http.get(ME_PATH, () => {
        hits += 1;
        return HttpResponse.json(
          { code: 'UNAUTHENTICATED', message: 'Not authenticated' },
          { status: 401 },
        );
      }),
    );

    const { result } = renderHook(() => useMe(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(hits).toBe(1);
    expect((result.current.error as unknown as { status: number }).status).toBe(
      401,
    );
  });

  it('hook retry: false wins even when client allows retries', async () => {
    // This catches the case where the hook option loses to the client default.
    // useMe explicitly sets retry: false — it must override makeClient({ retry: 2 }).
    let hits = 0;
    server.use(
      http.get(ME_PATH, () => {
        hits += 1;
        return HttpResponse.json(
          { code: 'UNAUTHENTICATED', message: 'Not authenticated' },
          { status: 401 },
        );
      }),
    );

    const { result } = renderHook(() => useMe(), {
      wrapper: makeWrapper(makeClient({ retry: 2 })),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hits).toBe(1);
  });
});

describe(useGitHubLinkStatus, () => {
  it('does not request link status when the feature is disabled', () => {
    const { result } = renderHook(() => useGitHubLinkStatus('user-a', false), {
      wrapper: makeWrapper(makeClient()),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });

  it('does not request status before a user is known', () => {
    const { result } = renderHook(() => useGitHubLinkStatus(undefined, true), {
      wrapper: makeWrapper(makeClient()),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });

  it('loads persisted status and keeps separate account caches', async () => {
    let linked = true;
    server.use(
      http.get(/\/auth\/github\/status$/, () => HttpResponse.json({ linked })),
    );
    const { result, rerender } = renderHook(
      ({ userId }) => useGitHubLinkStatus(userId, true),
      {
        initialProps: { userId: 'user-a' },
        wrapper: makeWrapper(makeClient()),
      },
    );
    await waitFor(() => expect(result.current.data).toEqual({ linked: true }));
    linked = false;
    rerender({ userId: 'user-b' });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual({ linked: false }));
  });
});

describe(useAuthConfig, () => {
  it.each([false, true])(
    'reads server-owned feature availability: %s',
    async (githubEnabled) => {
      server.use(
        http.get(/\/auth\/config$/, () => HttpResponse.json({ githubEnabled })),
      );
      const { result } = renderHook(() => useAuthConfig(), {
        wrapper: makeWrapper(makeClient()),
      });
      expect(result.current.data).toBeUndefined();
      await waitFor(() =>
        expect(result.current.data).toEqual({ githubEnabled }),
      );
    },
  );

  it('keeps availability unknown on configuration request failure', async () => {
    server.use(
      http.get(/\/auth\/config$/, () => HttpResponse.json({}, { status: 503 })),
    );
    const { result } = renderHook(() => useAuthConfig(), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
