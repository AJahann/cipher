import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeClient, makeWrapper } from '../../../test/helpers';
import { userKeys } from '../user/use-user';

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
  useChatSocketActions,
  type SendMessageData,
} from './use-chat-socket';

function rejectMessageSends(
  event: string,
  _data: SendMessageData,
  ack?: (value: unknown) => void,
) {
  if (event === 'message:send') {
    ack?.({ ok: false, error: 'FAILED_TO_SEND' });
  }
  return fakeSocket;
}

const payload: SendMessageData = {
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

  it('invalidates only the contact list when the socket connects', () => {
    const client = makeClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    const { unmount } = renderHook(() => useChatRealtimeSync(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      fakeSocket.trigger('connect');
    });

    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: userKeys.listRoot(),
    });

    unmount();
    act(() => {
      fakeSocket.trigger('connect');
    });

    expect(invalidateQueries).toHaveBeenCalledOnce();
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
      'FAILED_TO_SEND',
    );
    await expect(result.current.sendMessage(payload)).rejects.toThrow(
      'FAILED_TO_SEND',
    );

    const sends = fakeSocket.emit.mock.calls.filter(
      ([event]) => event === 'message:send',
    );
    expect(sends).toHaveLength(2);
    expect(sends[0][1]).toEqual(payload);
    expect(sends[1][1]).toEqual(payload);
  });
});
