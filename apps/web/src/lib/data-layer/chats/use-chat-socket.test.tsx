import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeClient, makeWrapper } from '../../../test/helpers';
import { userKeys } from '../user/use-user';

const { fakeSocket, ioMock } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  const listeners = new Map<string, Set<Listener>>();

  const socket = {
    connected: false,
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

vi.mock('socket.io-client', () => ({
  io: ioMock,
}));

import { useChatRealtimeSync } from './use-chat-socket';

describe('useChatRealtimeSync', () => {
  afterEach(() => {
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

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: userKeys.listRoot(),
    });

    unmount();
    act(() => {
      fakeSocket.trigger('connect');
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });
});