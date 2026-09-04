/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/web/src/lib/data-layer/chats/use-chat-socket.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import type { Message } from '@chat-app/shared/types';
import { chatKeys, type MessagesQueryParams } from './use-chat';
import { userKeys } from '../user/use-user';
import { env } from '@/config/env';

const SOCKET_URL = env.NEXT_PUBLIC_API_URL;

interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void;
  'message:ack': (data: { tempId: string; message: MessagePayload }) => void;
  /** Sent to the recipient's personal room even if the thread is not open. */
  'conversation:updated': (data: {
    conversationId: string;
    message: MessagePayload;
  }) => void;
  /** Broadcast when a new account is registered anywhere in the app. */
  'user:new': (user: { id: string; username: string }) => void;
  'typing:indicator': (data: {
    conversationId: string;
    userId: string;
    isTyping: boolean;
  }) => void;
  'presence:update': (data: { userId: string; online: boolean }) => void;
  error: (data: { code: string; message: string }) => void;
}

interface ClientToServerEvents {
  'message:send': (
    data: SendMessageData,
    ack: (result: AckResult) => void,
  ) => void;
  'typing:start': (data: { conversationId: string }) => void;
  'typing:stop': (data: { conversationId: string }) => void;
  'message:read': (data: { messageId: string; conversationId: string }) => void;
  'conversation:join': (data: { conversationId: string }) => void;
  'conversation:leave': (data: { conversationId: string }) => void;
}

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SendMessageData {
  tempId: string;
  conversationId: string;
  ciphertext: string;
  nonce: string;
  algorithm: string;
}

interface AckResult {
  ok: boolean;
  error?: string;
}

type MessagePayload = Message & {
  sender: { id: string; username: string };
};

// -----------------------------
// Singleton Socket
// -----------------------------
let socketInstance: AppSocket | null = null;
let refCount = 0;

function getSocket() {
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      withCredentials: true,
      autoConnect: false,
    });
  }
  return socketInstance;
}

// -----------------------------
// Hooks
// -----------------------------
export function useChatSocket(autoConnect = true) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    refCount += 1;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (socket.connected) setConnected(true);
    if (autoConnect && !socket.connected) socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);

      refCount -= 1;
      if (refCount <= 0) {
        socket.disconnect();
        refCount = 0;
      }
    };
  }, [autoConnect]);

  return { socket: getSocket(), connected };
}

export function useChatSocketEvents(handlers: Partial<ServerToClientEvents>) {
  const { socket } = useChatSocket(true);

  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  // Only the set of event names should retrigger the subscription. Depending on
  // `handlers` itself tore down and re-registered every listener on every
  // render, because callers pass a fresh object literal each time.
  const eventNames = Object.keys(handlers).sort().join('|');

  useEffect(() => {
    if (!eventNames) return;

    const names = eventNames.split('|') as (keyof ServerToClientEvents)[];

    const bound = names.map((event) => {
      const listener = (...args: any[]) =>
        (handlersRef.current[event] as any)?.(...args);
      socket.on(event as any, listener as any);
      return { event, listener };
    });

    return () => {
      bound.forEach(({ event, listener }) => {
        socket.off(event as any, listener as any);
      });
    };
  }, [socket, eventNames]);
}

export function useChatSocketActions() {
  const { socket } = useChatSocket(true);

  const sendMessage = useCallback(
    (data: SendMessageData) =>
      new Promise<AckResult>((resolve) => {
        socket.emit('message:send', data, (ack) => resolve(ack));
      }),
    [socket],
  );

  const typingStart = useCallback(
    (conversationId: string) => socket.emit('typing:start', { conversationId }),
    [socket],
  );

  const typingStop = useCallback(
    (conversationId: string) => socket.emit('typing:stop', { conversationId }),
    [socket],
  );

  const markRead = useCallback(
    (messageId: string, conversationId: string) =>
      socket.emit('message:read', { messageId, conversationId }),
    [socket],
  );

  const joinConversation = useCallback(
    (conversationId: string) =>
      socket.emit('conversation:join', { conversationId }),
    [socket],
  );

  const leaveConversation = useCallback(
    (conversationId: string) =>
      socket.emit('conversation:leave', { conversationId }),
    [socket],
  );

  return {
    sendMessage,
    typingStart,
    typingStop,
    markRead,
    joinConversation,
    leaveConversation,
  };
}

/**
 * Cache writers shared by the message-level and list-level realtime hooks.
 */
function useMessageCacheWriters() {
  const qc = useQueryClient();

  const upsertMessage = useCallback(
    (message: MessagePayload) => {
      const queries = qc.getQueriesData<Message[]>({
        queryKey: chatKeys.messagesRoot(),
      });

      queries.forEach(([key, data]) => {
        if (!data) return;

        const params = key[2] as MessagesQueryParams | undefined;
        if (params?.conversationId !== message.conversationId) return;

        if (data.some((m) => m.id === message.id)) return;

        qc.setQueryData(key, [...data, message]);
      });
    },
    [qc],
  );

  const replaceTemp = useCallback(
    (tempId: string, message: MessagePayload) => {
      const queries = qc.getQueriesData<Message[]>({
        queryKey: chatKeys.messagesRoot(),
      });

      queries.forEach(([key, data]) => {
        if (!data) return;

        const params = key[2] as MessagesQueryParams | undefined;
        if (params?.conversationId !== message.conversationId) return;

        if (!data.some((m) => m.id === tempId)) return;

        qc.setQueryData(
          key,
          data.map((m) => (m.id === tempId ? message : m)),
        );
      });
    },
    [qc],
  );

  return { upsertMessage, replaceTemp };
}

/**
 * Updates React Query message caches on message:new and message:ack.
 *
 * Mounted by the open conversation view.
 */
export function useChatRealtimeMessages() {
  const { upsertMessage, replaceTemp } = useMessageCacheWriters();

  useChatSocketEvents({
    'message:new': upsertMessage,
    'message:ack': ({ tempId, message }) => replaceTemp(tempId, message),
  });
}

/**
 * Keeps the contact and conversation lists in sync.
 *
 * Mount this once, high enough in the tree that it stays mounted while no
 * conversation is open — otherwise a user sitting on the empty state has no
 * socket listeners at all and never learns about incoming messages or new
 * accounts until they refresh.
 */
export function useChatRealtimeSync() {
  const qc = useQueryClient();
  const { upsertMessage } = useMessageCacheWriters();

  const refreshLists = useCallback(() => {
    qc.invalidateQueries({ queryKey: chatKeys.conversations() });
    qc.invalidateQueries({ queryKey: userKeys.listRoot() });
  }, [qc]);

  const onConversationUpdated = useCallback(
    ({ message }: { conversationId: string; message: MessagePayload }) => {
      upsertMessage(message);
      refreshLists();
    },
    [upsertMessage, refreshLists],
  );

  useChatSocketEvents({
    'conversation:updated': onConversationUpdated,
    'user:new': refreshLists,
  });
}
