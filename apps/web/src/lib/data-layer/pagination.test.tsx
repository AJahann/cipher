/* oxlint-disable max-nested-callbacks, vitest/no-conditional-in-test -- MSW handlers intentionally select fixture pages by cursor. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/msw/server';
import { makeClient, makeWrapper } from '../../test/helpers';
import { useMessageHistory } from './chats/use-chat';
import { useDirectory } from './user/use-user';

describe('cursor pagination exposed to the UI', () => {
  it('loads older messages, renders chronological order and deduplicates page boundaries', async () => {
    const message = (id: string) => ({
      id,
      clientMessageId: id,
      conversationId: 'conv',
      senderId: 'peer',
      ciphertext: 'encrypted',
      nonce: 'nonce',
      algorithm: 'x25519-xsalsa20-poly1305',
      createdAt: '2026-01-01T00:00:00Z',
      sender: { id: 'peer', username: 'peer' },
    });
    server.use(
      http.get(/\/chat\/messages$/, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('cursor')
            ? { items: [message('older'), message('new')], nextCursor: null }
            : { items: [message('new')], nextCursor: 'older-cursor' },
        ),
      ),
    );
    const { result } = renderHook(() => useMessageHistory('conv', 'me'), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() =>
      expect(result.current.data?.map((m) => m.id)).toEqual(['new']),
    );
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.data?.map((m) => m.id)).toEqual(['older', 'new']),
    );
    expect(result.current.hasNextPage).toBe(false);
  });
  it('does not truncate the directory at the first page', async () => {
    server.use(
      http.get(/\/users$/, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('cursor')
            ? { items: [{ id: 'b', username: 'Bob' }], nextCursor: null }
            : { items: [{ id: 'a', username: 'Alice' }], nextCursor: 'next' },
        ),
      ),
    );
    const { result } = renderHook(() => useDirectory('me'), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.data?.map((u) => u.username)).toEqual([
        'Alice',
        'Bob',
      ]),
    );
    expect(result.current.hasNextPage).toBe(false);
  });
});
