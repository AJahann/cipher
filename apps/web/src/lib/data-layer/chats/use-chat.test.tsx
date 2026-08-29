import { CONV_PATH, stubConversation } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderHook, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { useConversations, useCreateConversation } from './use-chat';
import { makeClient, makeWrapper } from '../../../test/helpers';

describe('useConversations', () => {
  it('is pending before the first response arrives', async () => {
    server.use(
      http.get(CONV_PATH, async () => {
        await delay(50);
        return HttpResponse.json([stubConversation]);
      }),
    );

    const { result } = renderHook(() => useConversations(), {
      wrapper: makeWrapper(makeClient()),
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('returns the list on 200, via a GET to /chat/conversations', async () => {
    let capturedRequest: Request | undefined;

    server.use(
      http.get(CONV_PATH, ({ request }) => {
        capturedRequest = request;
        return HttpResponse.json([stubConversation]);
      }),
    );

    const { result } = renderHook(() => useConversations(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(capturedRequest!.method).toBe('GET');
    expect(new URL(capturedRequest!.url).pathname).toMatch(CONV_PATH);
    expect(result.current.data).toEqual([stubConversation]);
  });

  it('exposes an error with status 500 when the server returns 500', async () => {
    server.use(
      http.get(CONV_PATH, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useConversations(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const err = result.current.error as unknown as { status: number };
    expect(err.status).toBe(500);
  });

  it('retries twice on failure then resolves — handler called 3 times total', async () => {
    let hits = 0;

    server.use(
      http.get(CONV_PATH, () => {
        hits++;
        return hits <= 2
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json([stubConversation]);
      }),
    );

    const { result } = renderHook(() => useConversations(), {
      wrapper: makeWrapper(makeClient({ retry: 2 })),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true), {
      timeout: 5_000,
    });

    expect(hits).toBe(3);
    expect(result.current.data).toEqual([stubConversation]);
  });

  describe('stale-time', () => {
    it('does not re-fetch on remount when staleTime is Infinity', async () => {
      let hits = 0;
      server.use(
        http.get(CONV_PATH, () => {
          hits++;
          return HttpResponse.json([stubConversation]);
        }),
      );

      const client = makeClient({ staleTime: Infinity });

      const { unmount } = renderHook(() => useConversations(), {
        wrapper: makeWrapper(client),
      });
      await waitFor(() => expect(hits).toBe(1));
      unmount();

      const { result } = renderHook(() => useConversations(), {
        wrapper: makeWrapper(client),
      });

      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toEqual([stubConversation]);

      await new Promise((r) => setTimeout(r, 100));
      expect(hits).toBe(1);
    });

    it('re-fetches on remount when staleTime is 0 and refetchOnMount is true', async () => {
      let hits = 0;
      server.use(
        http.get(CONV_PATH, () => {
          hits++;
          return HttpResponse.json([stubConversation]);
        }),
      );

      const client = makeClient({ staleTime: 0, refetchOnMount: true });

      const { unmount } = renderHook(() => useConversations(), {
        wrapper: makeWrapper(client),
      });
      await waitFor(() => expect(hits).toBe(1));
      unmount();

      renderHook(() => useConversations(), { wrapper: makeWrapper(client) });

      await waitFor(() => expect(hits).toBe(2));
    });
  });

  it('(useCreateConversation) POST 201 → conversations query re-fetches', async () => {
    let getHits = 0;
    server.use(
      http.get(CONV_PATH, () => {
        getHits++;
        return HttpResponse.json([stubConversation]);
      }),
      http.post(CONV_PATH, () =>
        HttpResponse.json(
          { ...stubConversation, id: 'conv-2' },
          { status: 201 },
        ),
      ),
    );

    const { result } = renderHook(
      () => ({ list: useConversations(), create: useCreateConversation() }),
      { wrapper: makeWrapper(makeClient()) },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(getHits).toBe(1);

    result.current.create.mutate({ memberId: 'user-x' });

    await waitFor(() => expect(getHits).toBe(2));
    expect(result.current.list.isSuccess).toBe(true);
  });
});
