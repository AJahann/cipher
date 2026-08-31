import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MESSAGES_PATH, stubMessage } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { useMessages } from './use-chat';
import { makeClient, makeWrapper } from '../../../test/helpers';

describe('useMessages', () => {
  it('does not fetch when conversationId is omitted — enabled: false', () => {
    let hits = 0;
    server.use(
      http.get(MESSAGES_PATH, () => {
        hits++;
        return HttpResponse.json([stubMessage]);
      }),
    );

    const { result } = renderHook(() => useMessages(), {
      wrapper: makeWrapper(makeClient()),
    });

    // enabled: false → status: 'pending', fetchStatus: 'idle'
    // isFetching (not isPending) is the right assertion — isPending is true but fetchStatus is idle
    expect(result.current.isFetching).toBe(false);
    expect(hits).toBe(0);
  });

  it('GETs /chat/messages with conversationId in the query string', async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.get(MESSAGES_PATH, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([stubMessage]);
      }),
    );

    const { result } = renderHook(() => useMessages('conv-1'), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = new URL(capturedUrl!);
    expect(url.searchParams.get('conversationId')).toBe('conv-1');
    expect(result.current.data).toEqual([stubMessage]);
  });

  it('re-fetches when conversationId changes — different query key', async () => {
    let hits = 0;
    server.use(
      http.get(MESSAGES_PATH, () => {
        hits++;
        return HttpResponse.json([stubMessage]);
      }),
    );

    const { rerender } = renderHook(
      ({ id }: { id: string }) => useMessages(id),
      {
        wrapper: makeWrapper(makeClient()),
        initialProps: { id: 'conv-1' },
      },
    );

    await waitFor(() => expect(hits).toBe(1));

    rerender({ id: 'conv-2' });

    await waitFor(() => expect(hits).toBe(2));
  });
});
