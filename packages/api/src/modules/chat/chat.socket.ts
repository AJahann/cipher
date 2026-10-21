// oxlint-disable max-lines-per-function
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { parseCookie } from 'cookie';
import type { Store } from 'express-session';
import {
  conversationRefSchema,
  messageReadSchema,
  sendMessageSchema,
  type ClientToServerEvents,
  type MessageDto,
  type SendMessageAck,
  type ServerToClientEvents,
} from '@chat-app/shared/contracts';
import { chatService } from './chat.service';
import { userService } from '../user/user.service';
import { AppError, toApiError } from '../../http/errors';
import { sessionRoom } from '../auth/session-authority';
import { createLimiter } from '../../security/rate-limit';

interface SocketData {
  userId: string;
  sessionId: string;
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

/** Connection refusal; the client reads `err.message` and `err.data`. */
function unauthenticated() {
  const err = new Error('UNAUTHENTICATED') as Error & {
    data: { code: 'UNAUTHENTICATED'; message: string };
  };
  err.data = { code: 'UNAUTHENTICATED', message: 'Not authenticated' };
  return err;
}

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
  const handshakeLimit = createLimiter(60, 60_000);
  const eventLimit = createLimiter(120, 10_000);
  io.use(async (socket, next) => {
    try {
      handshakeLimit(socket.handshake.address);
      const rawCookie = socket.handshake.headers.cookie ?? '';
      const cookies = parseCookie(rawCookie);
      const rawSid = cookies.sessionId;

      if (!rawSid) return next(unauthenticated());

      const unsigned = app.unsignCookie(rawSid);
      if (!unsigned.valid) return next(unauthenticated());

      const sid = unsigned.value;
      const session = await new Promise<Record<string, unknown> | null>(
        (resolve, reject) => {
          store.get(sid, (err, sess) => {
            if (err) reject(err);
            else resolve((sess as unknown as Record<string, unknown>) ?? null);
          });
        },
      );

      const userId = session?.userId as string | undefined;
      if (!userId) return next(unauthenticated());

      socket.data.userId = userId;
      socket.data.sessionId = sid;
      next();
    } catch (err) {
      log.error(err, 'Socket auth error');
      next(unauthenticated());
    }
  });

  io.on('connection', async (socket: AppSocket) => {
    const { userId } = socket.data;
    socket.join(userRoom(userId));
    socket.join(sessionRoom(socket.data.sessionId));
    const limit = () => eventLimit(userId);
    const authorize = async () => {
      const current = await new Promise<Record<string, any> | null>(
        (resolve, reject) => {
          store.get(socket.data.sessionId, (error, value) => {
            if (error) reject(error);
            else resolve(value ?? null);
          });
        },
      );
      const expires = current?.cookie?.expires;
      if (
        !current ||
        current.userId !== userId ||
        (expires && new Date(expires).getTime() <= Date.now())
      ) {
        socket.disconnect(true);
        throw new AppError('UNAUTHENTICATED');
      }
    };
    // Idle sockets must lose receive authority too, not just send authority.
    const authorityTimer = setInterval(() => {
      void authorize().catch(() => socket.disconnect(true));
    }, 5_000);
    authorityTimer.unref();
    socket.once('disconnect', () => clearInterval(authorityTimer));
    // Close a revocation race between handshake and session-room join.
    try {
      await authorize();
    } catch {
      socket.disconnect(true);
      return;
    }

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

    /** Reports a rejected fire-and-forget event back to the sender only. */
    const reject = (event: keyof ClientToServerEvents, err: unknown) => {
      const { status, body } = toApiError(err);
      if (status >= 500) log.error(err, `${event} failed`);
      socket.emit('error', { event, error: body });
    };

    socket.on('message:send', async (data, ack) => {
      const reply = (result: SendMessageAck) => {
        if (typeof ack === 'function') ack(result);
      };
      try {
        limit();
        await authorize();
        const parsed = sendMessageSchema.parse(data);

        const { message, replayed } = await chatService.sendMessage({
          ...parsed,
          senderId: userId,
        });

        const payload: MessageDto = {
          ...message,
          createdAt: message.createdAt.toISOString(),
          sender: { id: userId, username: socket.data.username },
        };

        // A persisted command is not proof of peer delivery. Replays safely
        // repeat notification; consumers deduplicate by the persisted message ID.
        const memberIds = await chatService.getConversationMembers(
          parsed.conversationId,
        );
        for (const memberId of memberIds) {
          io.in(userRoom(memberId)).socketsJoin(
            conversationRoom(parsed.conversationId),
          );
          if (memberId !== userId) {
            io.to(userRoom(memberId)).emit('conversation:updated', {
              conversationId: parsed.conversationId,
              message: payload,
            });
          }
        }
        io.to(conversationRoom(parsed.conversationId)).emit(
          'message:new',
          payload,
        );

        socket.emit('message:ack', {
          clientMessageId: parsed.clientMessageId,
          message: payload,
        });
        reply({ ok: true, message: payload, replayed });
      } catch (err) {
        const { status, body } = toApiError(err);
        if (status >= 500) log.error(err, 'message:send failed');
        reply({ ok: false, error: body });
      }
    });

    socket.on('message:read', async (data) => {
      try {
        limit();
        await authorize();
        const { messageId, conversationId } = messageReadSchema.parse(data);
        await chatService.markRead(messageId, conversationId, userId);
      } catch (err) {
        reject('message:read', err);
      }
    });

    const typing =
      (event: 'typing:start' | 'typing:stop', isTyping: boolean) =>
      async (data: unknown) => {
        try {
          limit();
          await authorize();
          const parsed = conversationRefSchema.safeParse(data);
          if (!parsed.success) return reject(event, parsed.error);
          const room = conversationRoom(parsed.data.conversationId);
          // Rooms are only ever joined after a membership check, so being in the
          // room is the authorisation. Typing is ephemeral: no DB round-trip.
          if (!socket.rooms.has(room)) {
            return reject(event, new AppError('CONVERSATION_NOT_FOUND'));
          }
          socket.to(room).emit('typing:indicator', {
            conversationId: parsed.data.conversationId,
            userId,
            isTyping,
          });
        } catch (error) {
          reject(event, error);
        }
      };

    socket.on('typing:start', typing('typing:start', true));
    socket.on('typing:stop', typing('typing:stop', false));

    socket.on('conversation:join', async (data) => {
      try {
        limit();
        await authorize();
        const { conversationId } = conversationRefSchema.parse(data);
        if (!(await chatService.isMember(conversationId, userId))) {
          throw new AppError('CONVERSATION_NOT_FOUND');
        }
        socket.join(conversationRoom(conversationId));
      } catch (err) {
        reject('conversation:join', err);
      }
    });

    socket.on('conversation:leave', (data) => {
      const parsed = conversationRefSchema.safeParse(data);
      if (!parsed.success) return reject('conversation:leave', parsed.error);
      socket.leave(conversationRoom(parsed.data.conversationId));
    });

    socket.on('disconnect', async () => {
      log.info({ userId }, 'Socket disconnected');
      const remaining = await io.in(userRoom(userId)).fetchSockets();
      if (remaining.length === 0) await broadcastPresence(io, userId, false);
    });
  });
}
