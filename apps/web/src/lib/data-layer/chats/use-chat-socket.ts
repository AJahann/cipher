/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/web/src/hooks/use-chat-socket.ts
import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import type { Message } from '@chat-app/shared/types'; // <- adjust path
import { chatKeys } from './use-chat';
import { env } from '@/config/env';

const SOCKET_URL = env.NEXT_PUBLIC_API_URL;

interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void;
  'message:ack': (data: { tempId: string; message: MessagePayload }) => void;
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

  useEffect(() => {
    Object.entries(handlers).forEach(([event, handler]) => {
      if (handler)
        socket.on(event as keyof ServerToClientEvents, handler as any);
    });

    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        if (handler)
          socket.off(event as keyof ServerToClientEvents, handler as any);
      });
    };
  }, [socket, handlers]);
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
 * Updates React Query message caches on message:new and message:ack
 */
export function useChatRealtimeMessages() {
  const qc = useQueryClient();

  const upsertMessage = useCallback(
    (message: MessagePayload) => {
      const queries = qc.getQueriesData<Message[]>({
        queryKey: chatKeys.messages(message.conversationId),
        exact: false,
      });

      queries.forEach(([key, data]) => {
        console.log(key, data);

        if (!data) return;

        const exists = data.some((m) => m.id === message.id);
        if (exists) return;

        const updated = [...data, message];

        qc.setQueryData(key, updated);
      });
    },
    [qc],
  );

  const replaceTemp = useCallback(
    (tempId: string, message: MessagePayload) => {
      const queries = qc.getQueriesData<Message[]>({
        queryKey: chatKeys.messages(message.conversationId),
        exact: false,
      });

      queries.forEach(([key, data]) => {
        if (!data) return;

        qc.setQueryData(
          key,
          data.map((m) => (m.id === tempId ? message : m)),
        );
      });
    },
    [qc],
  );

  useChatSocketEvents({
    'message:new': upsertMessage,
    'message:ack': ({ tempId, message }) => replaceTemp(tempId, message),
  });
}
