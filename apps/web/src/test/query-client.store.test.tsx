import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { CONV_PATH, stubConversation } from './msw/handlers';
import { server } from './msw/server';
import { useConversations } from '../lib/data-layer/chats/use-chat';
import { makeClient, makeWrapper } from './helpers';

describe('QueryClient as store', () => {
  it('two hooks on the same client share the cache — one GET after first fetch', async () => {
    let hits = 0;
    server.use(
      http.get(CONV_PATH, () => {
        hits += 1;
        return HttpResponse.json([stubConversation]);
      }),
    );

    const client = makeClient({ staleTime: Infinity });
    const wrapper = makeWrapper(client);

    const { result: r1 } = renderHook(() => useConversations(), { wrapper });
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));
    expect(hits).toBe(1);

    const { result: r2 } = renderHook(() => useConversations(), { wrapper });
    expect(r2.current.isSuccess).toBe(true);
    expect(r2.current.data).toEqual([stubConversation]);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hits).toBe(1);
  });

  it('two hooks on separate clients fetch independently — two GETs', async () => {
    let hits = 0;
    server.use(
      http.get(CONV_PATH, () => {
        hits += 1;
        return HttpResponse.json([stubConversation]);
      }),
    );

    const clientA = makeClient();
    const clientB = makeClient();

    const { result: rA } = renderHook(() => useConversations(), {
      wrapper: makeWrapper(clientA),
    });
    const { result: rB } = renderHook(() => useConversations(), {
      wrapper: makeWrapper(clientB),
    });

    await waitFor(() => expect(rA.current.isSuccess).toBe(true));
    await waitFor(() => expect(rB.current.isSuccess).toBe(true));
    expect(hits).toBe(2);
  });
});
