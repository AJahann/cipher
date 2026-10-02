import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import type { Message } from '@chat-app/shared/types';
import type {
  ClientToServerEvents,
  MessageDto,
  SendMessageAck,
  SendMessageInput,
  ServerToClientEvents,
} from '@chat-app/shared/contracts';
import { chatKeys, type MessagesQueryParams } from './use-chat';
import { userKeys } from '../user/use-user';
import { env } from '../../../config/env';

const SOCKET_URL = env.NEXT_PUBLIC_API_URL;
const SEND_ACK_TIMEOUT_MS = 8_000;

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type MessagePayload = MessageDto;

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

  return socket;
}

export function useChatSocketActions() {
  const { socket } = useChatSocket(true);

  const sendMessage = useCallback(
    (data: SendMessageInput) =>
      new Promise<Extract<SendMessageAck, { ok: true }>>((resolve, reject) => {
        if (!socket.connected) {
          reject(new Error('SOCKET_DISCONNECTED'));
          return;
        }

        let settled = false;
        const timer = window.setTimeout(() => {
          settled = true;
          reject(new Error('MESSAGE_ACK_TIMEOUT'));
        }, SEND_ACK_TIMEOUT_MS);

        socket.emit('message:send', data, (ack) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);

          if (!ack.ok) {
            // Machine-readable code from the shared error envelope.
            reject(new Error(ack.error.code));
            return;
          }
          resolve(ack);
        });
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

  const replacePending = useCallback(
    (clientMessageId: string, message: MessagePayload) => {
      const queries = qc.getQueriesData<Message[]>({
        queryKey: chatKeys.messagesRoot(),
      });

      queries.forEach(([key, data]) => {
        if (!data) return;
        const params = key[2] as MessagesQueryParams | undefined;
        if (params?.conversationId !== message.conversationId) return;
        if (!data.some((m) => m.clientMessageId === clientMessageId)) return;
        qc.setQueryData(
          key,
          data.map((m) =>
            m.clientMessageId === clientMessageId ? message : m,
          ),
        );
      });
    },
    [qc],
  );

  return { upsertMessage, replacePending };
}

export function useChatRealtimeMessages() {
  const { upsertMessage, replacePending } = useMessageCacheWriters();
  useChatSocketEvents({
    'message:new': upsertMessage,
    'message:ack': ({ clientMessageId, message }) =>
      replacePending(clientMessageId, message),
  });
}

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

  const socket = useChatSocketEvents({
    'conversation:updated': onConversationUpdated,
    'user:new': refreshLists,
  });

  useEffect(() => {
    const onConnect = () => {
      qc.invalidateQueries({ queryKey: userKeys.listRoot() });
    };

    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [qc, socket]);
}
