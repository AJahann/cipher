import type { SendMessageInput } from '@chat-app/shared/contracts';
import {
  act,
  renderHook,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeClient, makeWrapper } from '../../../test/helpers';
import { userKeys } from '../user/use-user';
import { chatKeys, useMessageHistory } from './use-chat';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/msw/server';
import { MESSAGES_PATH, stubMessage } from '../../../test/msw/handlers';

const { fakeSocket, ioMock } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  const listeners = new Map<string, Set<Listener>>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return socket;
    }),
    off: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
      return socket;
    }),
    connect: vi.fn(() => socket),
    disconnect: vi.fn(() => socket),
    emit: vi.fn(),
    trigger(event: string, ...args: unknown[]) {
      listeners.get(event)?.forEach((listener) => listener(...args));
    },
  };

  return {
    fakeSocket: socket,
    ioMock: vi.fn(() => socket),
  };
});

vi.mock(import('socket.io-client'), () => ({
  io: ioMock as unknown as typeof import('socket.io-client').io,
}));

// oxlint-disable-next-line import/first -- Vitest hoists this mock before the module import.
import {
  useChatRealtimeSync,
  useChatRealtimeMessages,
  useChatSocketActions,
} from './use-chat-socket';

function rejectMessageSends(
  event: string,
  _data: SendMessageInput,
  ack?: (value: unknown) => void,
) {
  if (event === 'message:send') {
    ack?.({
      ok: false,
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  }
  return fakeSocket;
}

const payload: SendMessageInput = {
  clientMessageId: '44444444-4444-4444-8444-444444444444',
  conversationId: '33333333-3333-4333-8333-333333333333',
  ciphertext: 'ciphertext-a',
  nonce: 'nonce-a',
  algorithm: 'x25519-xsalsa20-poly1305',
};

describe('chat socket hooks', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('reconciles contacts, conversations and histories on transport reconnect', () => {
    const client = makeClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    const { unmount } = renderHook(() => useChatRealtimeSync(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      fakeSocket.trigger('connect');
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(5);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: userKeys.listRoot(),
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: chatKeys.historyRoot(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: chatKeys.messagesRoot(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: chatKeys.conversations(),
    });
    unmount();
    act(() => {
      fakeSocket.trigger('connect');
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(5);
  });

  it('rejects an unacknowledged send after the bounded timeout', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatSocketActions(), {
      wrapper: makeWrapper(makeClient()),
    });

    const send = result.current.sendMessage(payload);
    // Attach a handler right away so the pending rejection is never reported
    // as unhandled while the fake timers advance.
    send.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(8_000);
    await expect(send).rejects.toThrow('MESSAGE_ACK_TIMEOUT');
  });

  it('retries with the original client key and encrypted payload', async () => {
    fakeSocket.emit.mockImplementation(rejectMessageSends);

    const { result } = renderHook(() => useChatSocketActions(), {
      wrapper: makeWrapper(makeClient()),
    });

    await expect(result.current.sendMessage(payload)).rejects.toThrow(
      'INTERNAL',
    );
    await expect(result.current.sendMessage(payload)).rejects.toThrow(
      'INTERNAL',
    );

    const sends = fakeSocket.emit.mock.calls.filter(
      ([event]) => event === 'message:send',
    );
    expect(sends).toHaveLength(2);
    expect(sends[0][1]).toEqual(payload);
    expect(sends[1][1]).toEqual(payload);
  });
  it('repeated async job notifications converge on one rendered history bubble', async () => {
    let reads = 0;
    const message = {
      ...stubMessage,
      conversationId: payload.conversationId,
      ciphertext: 'one-durable-bubble',
    };
    let items: (typeof message)[] = [];
    server.use(
      http.get(MESSAGES_PATH, () => {
        reads += 1;
        return HttpResponse.json({
          items,
          nextCursor: null,
        });
      }),
    );
    function Bubbles() {
      useChatRealtimeSync();
      useChatRealtimeMessages();
      const { data } = useMessageHistory(payload.conversationId, 'account');
      return (
        <ul>
          {data?.map((m) => (
            <li key={m.id}>{m.ciphertext}</li>
          ))}
        </ul>
      );
    }
    render(<Bubbles />, { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(reads).toBe(1));
    items = [message];
    act(() => {
      for (const _attempt of [1, 2]) {
        fakeSocket.trigger('message:new', message);
        fakeSocket.trigger('conversation:updated', {
          conversationId: message.conversationId,
          message,
        });
      }
    });
    await waitFor(() =>
      expect(screen.getAllByText('one-durable-bubble')).toHaveLength(1),
    );
    act(() => fakeSocket.trigger('message:new', message));
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(screen.getAllByText('one-durable-bubble')).toHaveLength(1);
  });
});
