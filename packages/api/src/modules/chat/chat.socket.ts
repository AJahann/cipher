// oxlint-disable max-lines-per-function
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { parseCookie } from 'cookie';
import type { Store } from 'express-session';
import { ZodError } from 'zod';
import { chatService } from './chat.service';
import { sendMessageSchema } from './chat.schema';
import { userService } from '../user/user.service';

interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void;
  'message:ack': (data: { tempId: string; message: MessagePayload }) => void;
  'conversation:updated': (data: {
    conversationId: string;
    message: MessagePayload;
  }) => void;
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

interface MessagePayload {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  ciphertext: string;
  nonce: string;
  algorithm: string;
  createdAt: string;
  sender: { id: string; username: string };
}

interface SocketData {
  userId: string;
  username: string;
}

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  object,
  SocketData
>;
type AppIO = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  object,
  SocketData
>;

const userRoom = (userId: string) => `user:${userId}`;
const conversationRoom = (conversationId: string) => `conv:${conversationId}`;

async function broadcastPresence(io: AppIO, userId: string, online: boolean) {
  const conversationIds = await chatService
    .getConversationIds(userId)
    .catch(() => []);
  for (const id of conversationIds) {
    io.to(conversationRoom(id)).emit('presence:update', { userId, online });
  }
}

export function registerChatSocket(
  io: AppIO,
  log: FastifyBaseLogger,
  store: Store,
  app: FastifyInstance,
) {
  io.use(async (socket, next) => {
    try {
      const rawCookie = socket.handshake.headers.cookie ?? '';
      const cookies = parseCookie(rawCookie);
      const rawSid = cookies.sessionId;

      if (!rawSid) return next(new Error('UNAUTHORIZED'));

      const unsigned = app.unsignCookie(rawSid);
      if (!unsigned.valid) return next(new Error('UNAUTHORIZED'));

      const sid = unsigned.value;
      const session = await new Promise<Record<string, unknown> | null>(
        (resolve, reject) => {
          store.get(sid, (err, sess) => {
            if (err) reject(err);
            else resolve((sess as unknown as Record<string, unknown>) ?? null);
          });
        },
      );

      log.info({ sid, userId: session?.userId }, 'Socket session loaded');

      const userId = session?.userId as string | undefined;
      if (!userId) return next(new Error('UNAUTHORIZED'));

      socket.data.userId = userId;
      next();
    } catch (err) {
      log.error(err, 'Socket auth error');
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', async (socket: AppSocket) => {
    const { userId } = socket.data;
    socket.join(userRoom(userId));

    const conversationIds = await chatService
      .getConversationIds(userId)
      .catch(() => [] as string[]);
    for (const id of conversationIds) socket.join(conversationRoom(id));

    const profile = await userService.findById(userId).catch(() => null);
    socket.data.username = profile?.username ?? '';

    log.info(
      { userId, conversations: conversationIds.length },
      'Socket connected',
    );

    await broadcastPresence(io, userId, true);

    socket.on('message:send', async (data, ack) => {
      try {
        const parsed = sendMessageSchema.parse(data);

        const message = await chatService.sendMessage({
          clientMessageId: parsed.tempId,
          conversationId: parsed.conversationId,
          senderId: userId,
          ciphertext: parsed.ciphertext,
          nonce: parsed.nonce,
          algorithm: parsed.algorithm,
        });

        const payload: MessagePayload = {
          ...message,
          createdAt: message.createdAt.toISOString(),
          sender: { id: userId, username: socket.data.username },
        };

        io.to(conversationRoom(parsed.conversationId)).emit(
          'message:new',
          payload,
        );

        const memberIds = await chatService.getConversationMembers(
          parsed.conversationId,
        );

        for (const memberId of memberIds) {
          if (memberId === userId) continue;

          io.in(userRoom(memberId)).socketsJoin(
            conversationRoom(parsed.conversationId),
          );

          io.to(userRoom(memberId)).emit('conversation:updated', {
            conversationId: parsed.conversationId,
            message: payload,
          });
        }

        socket.emit('message:ack', {
          tempId: parsed.tempId,
          message: payload,
        });
        ack({ ok: true });
      } catch (err) {
        log.error(err, 'message:send failed');
        if (err instanceof ZodError) {
          ack({ ok: false, error: 'VALIDATION_ERROR' });
        } else if (err instanceof Error && err.message === 'FORBIDDEN') {
          ack({ ok: false, error: 'FORBIDDEN' });
        } else if (
          err instanceof Error &&
          err.message === 'IDEMPOTENCY_CONFLICT'
        ) {
          ack({ ok: false, error: 'IDEMPOTENCY_CONFLICT' });
        } else {
          ack({ ok: false, error: 'FAILED_TO_SEND' });
        }
      }
    });

    socket.on('message:read', async ({ messageId }) => {
      try {
        await chatService.markRead(messageId, userId);
      } catch (err) {
        log.error(err, 'message:read failed');
      }
    });

    socket.on('typing:start', ({ conversationId }) => {
      socket.to(conversationRoom(conversationId)).emit('typing:indicator', {
        conversationId,
        userId,
        isTyping: true,
      });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      socket.to(conversationRoom(conversationId)).emit('typing:indicator', {
        conversationId,
        userId,
        isTyping: false,
      });
    });

    socket.on('conversation:join', ({ conversationId }) => {
      socket.join(conversationRoom(conversationId));
    });

    socket.on('conversation:leave', ({ conversationId }) => {
      socket.leave(conversationRoom(conversationId));
    });

    socket.on('disconnect', async () => {
      log.info({ userId }, 'Socket disconnected');
      await broadcastPresence(io, userId, false);
    });
  });
}
