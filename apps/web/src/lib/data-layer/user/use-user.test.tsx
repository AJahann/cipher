import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { ME_PATH, stubUser } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { useMe } from './use-user';
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
        hits++;
        return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
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
        hits++;
        return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
      }),
    );

    const { result } = renderHook(() => useMe(), {
      wrapper: makeWrapper(makeClient({ retry: 2 })),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hits).toBe(1);
  });
});
