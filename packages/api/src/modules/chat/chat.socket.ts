import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { parseCookie } from 'cookie';
import type { Store } from 'express-session';
import { ZodError } from 'zod';
import { chatService } from './chat.service';
import { sendMessageSchema } from './chat.schema';
import { sessionStore } from '../../db/session';

// ── Event shape interfaces ────────────────────────────────────────────────────

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

interface SendMessageData {
  tempId: string; // client-generated optimistic ID for ACK correlation
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
}

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  {},
  SocketData
>;
type AppIO = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  {},
  SocketData
>;

// ── Room helpers ──────────────────────────────────────────────────────────────

const userRoom = (userId: string) => `user:${userId}`;
const conversationRoom = (conversationId: string) => `conv:${conversationId}`;

// ── Presence helper ───────────────────────────────────────────────────────────

async function broadcastPresence(io: AppIO, userId: string, online: boolean) {
  const conversationIds = await chatService
    .getConversationIds(userId)
    .catch(() => []);
  for (const id of conversationIds) {
    io.to(conversationRoom(id)).emit('presence:update', { userId, online });
  }
}

// ── Main registration ─────────────────────────────────────────────────────────

export function registerChatSocket(
  io: AppIO,
  log: FastifyBaseLogger,
  store: Store,
  app: FastifyInstance,
) {
  // ── Auth middleware ───────────────────────────────────────────────────────

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

  // ── Connection handler ────────────────────────────────────────────────────

  io.on('connection', async (socket) => {
    const userId = socket.data.userId;

    socket.join(userRoom(userId));
    log.info({ userId }, 'Socket connected');

    // Broadcast online presence to all shared conversations
    await broadcastPresence(io, userId, true);

    // ── message:send ────────────────────────────────────────────────────────

    socket.on('message:send', async (data, ack) => {
      try {
        const parsed = sendMessageSchema.parse(data);

        const message = await chatService.sendMessage({
          conversationId: parsed.conversationId,
          senderId: userId,
          ciphertext: parsed.ciphertext,
          nonce: parsed.nonce,
          algorithm: parsed.algorithm,
        });

        const payload: MessagePayload = {
          ...message,
          createdAt: message.createdAt.toISOString(),
          sender: { id: userId, username: '' }, // username hydrated below if needed
        };

        // Broadcast to everyone in the conversation room
        io.to(conversationRoom(parsed.conversationId)).emit(
          'message:new',
          payload,
        );

        // ACK back to sender with tempId so optimistic UI can reconcile
        socket.emit('message:ack', { tempId: data.tempId, message: payload });

        ack({ ok: true });
      } catch (err) {
        log.error(err, 'message:send failed');
        if (err instanceof ZodError) {
          ack({ ok: false, error: 'VALIDATION_ERROR' });
        } else if (err instanceof Error && err.message === 'FORBIDDEN') {
          ack({ ok: false, error: 'FORBIDDEN' });
        } else {
          ack({ ok: false, error: 'FAILED_TO_SEND' });
        }
      }
    });

    // ── message:read ────────────────────────────────────────────────────────

    socket.on('message:read', async ({ messageId }) => {
      try {
        await chatService.markRead(messageId, userId);
      } catch (err) {
        log.error(err, 'message:read failed');
      }
    });

    // ── typing indicators ────────────────────────────────────────────────────

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

    // ── conversation rooms ───────────────────────────────────────────────────

    socket.on('conversation:join', ({ conversationId }) => {
      socket.join(conversationRoom(conversationId));
    });

    socket.on('conversation:leave', ({ conversationId }) => {
      socket.leave(conversationRoom(conversationId));
    });

    // ── disconnect ───────────────────────────────────────────────────────────

    socket.on('disconnect', async () => {
      log.info({ userId }, 'Socket disconnected');
      await broadcastPresence(io, userId, false);
    });
  });
}
