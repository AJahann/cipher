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
  io.use(async (socket, next) => {
    try {
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

      log.info({ sid, userId: session?.userId }, 'Socket session loaded');

      const userId = session?.userId as string | undefined;
      if (!userId) return next(unauthenticated());

      socket.data.userId = userId;
      next();
    } catch (err) {
      log.error(err, 'Socket auth error');
      next(unauthenticated());
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

        // A replay is a retry of a message every member already received, so
        // only the sender hears about it again. Clients dedupe by `id`.
        if (!replayed) {
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
        }

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
        const { messageId, conversationId } = messageReadSchema.parse(data);
        await chatService.markRead(messageId, conversationId, userId);
      } catch (err) {
        reject('message:read', err);
      }
    });

    const typing =
      (event: 'typing:start' | 'typing:stop', isTyping: boolean) =>
      (data: unknown) => {
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
      };

    socket.on('typing:start', typing('typing:start', true));
    socket.on('typing:stop', typing('typing:stop', false));

    socket.on('conversation:join', async (data) => {
      try {
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
      await broadcastPresence(io, userId, false);
    });
  });
}
