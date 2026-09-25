// oxlint-disable max-lines-per-function
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { parseCookie } from 'cookie';
import type { Store } from 'express-session';
import { ZodError } from 'zod';
import { chatService } from './chat.service';
import { sendMessageSchema } from './chat.schema';
import { userService } from '../user/user.service';

// ── Event shape interfaces ──────────────────────────────────────────────────

interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void;
  'message:ack': (data: { tempId: string; message: MessagePayload }) => void;
  /**
   * Delivered to every member's personal room when a conversation receives a
   * message.
   *
   * `message:new` only reaches sockets that joined the conversation room, and a
   * client joins that room when the user opens the thread. A recipient who has
   * never opened it — or who does not even have the sender in their contact
   * list yet — would otherwise receive nothing until a page refresh.
   */
  'conversation:updated': (data: {
    conversationId: string;
    message: MessagePayload;
  }) => void;
  /** Broadcast to all connected clients when a new account is registered. */
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

  io.on('connection', async (socket: AppSocket) => {
    const { userId } = socket.data;

    socket.join(userRoom(userId));

    // Join every conversation this user already belongs to. Previously a client
    // only entered a conversation room after the user clicked that contact, so
    // incoming messages and presence updates never reached anyone who had not
    // opened the thread in this session.
    const conversationIds = await chatService
      .getConversationIds(userId)
      .catch(() => [] as string[]);
    for (const id of conversationIds) socket.join(conversationRoom(id));

    // Cached once so outgoing message payloads carry a real sender name.
    const profile = await userService.findById(userId).catch(() => null);
    socket.data.username = profile?.username ?? '';

    log.info(
      { userId, conversations: conversationIds.length },
      'Socket connected',
    );

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
          sender: { id: userId, username: socket.data.username },
        };

        // 1. Everyone currently viewing the thread.
        io.to(conversationRoom(parsed.conversationId)).emit(
          'message:new',
          payload,
        );

        // 2. Everyone else in the conversation, through their personal room.
        //    This is what reaches a recipient who has never opened the thread.
        const memberIds = await chatService.getConversationMembers(
          parsed.conversationId,
        );

        for (const memberId of memberIds) {
          if (memberId === userId) continue;

          // Pull their live sockets into the conversation room so subsequent
          // messages, typing indicators and presence updates arrive directly.
          // Done after the emit above so they do not receive this message twice.
          io.in(userRoom(memberId)).socketsJoin(
            conversationRoom(parsed.conversationId),
          );

          io.to(userRoom(memberId)).emit('conversation:updated', {
            conversationId: parsed.conversationId,
            message: payload,
          });
        }

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
