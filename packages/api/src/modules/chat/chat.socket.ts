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
import type { Presence } from '../../redis/presence';

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
export type AppIO = SocketIOServer<
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

export function registerChatSocket(
  io: AppIO,
  log: FastifyBaseLogger,
  store: Store,
  { app, presence }: { app: FastifyInstance; presence: Presence },
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

      const userId = session?.userId as string | undefined;
      if (!userId) return next(unauthenticated());

      app.securityBudgets.take('account.connect', userId);
      socket.data.userId = userId;
      socket.data.sessionId = sid;
      next();
    } catch (err) {
      if (toApiError(err).body.code === 'RATE_LIMITED') {
        const error = new Error('RATE_LIMITED');
        return next(error);
      }
      log.warn('Socket authentication refused');
      next(unauthenticated());
    }
  });

  io.on('connection', async (socket: AppSocket) => {
    const { userId } = socket.data;
    try {
      const release = app.securityBudgets.connect(userId);
      socket.once('disconnect', release);
    } catch (_error) {
      socket.disconnect(true);
      return;
    }
    socket.join(userRoom(userId));
    socket.join(sessionRoom(socket.data.sessionId));
    const limit = () => app.securityBudgets.take('account.event', userId);
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
    } catch (_error) {
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

    /** Reports a rejected fire-and-forget event back to the sender only. */
    const reject = (event: keyof ClientToServerEvents, err: unknown) => {
      const { status, body } = toApiError(err);
      if (status >= 500) log.error({ event }, 'Socket event failed');
      socket.emit('error', { event, error: body });
    };

    socket.on('message:send', async (data, ack) => {
      const reply = (result: SendMessageAck) => {
        if (typeof ack === 'function') ack(result);
      };
      try {
        limit();
        const parsed = sendMessageSchema.parse(data);
        await authorize();

        const { message, replayed } = await chatService.sendMessage({
          ...parsed,
          senderId: userId,
        });

        const payload: MessageDto = {
          ...message,
          createdAt: message.createdAt.toISOString(),
          sender: { id: userId, username: socket.data.username },
        };

        // Durable message + intent acceptance only. Notification happens in the
        // in-process background consumer; Redis/peer availability is not an ack gate.
        socket.emit('message:ack', {
          clientMessageId: parsed.clientMessageId,
          message: payload,
        });
        reply({ ok: true, message: payload, replayed });
      } catch (err) {
        const { status, body } = toApiError(err);
        if (status >= 500) log.error('message:send failed');
        reply({ ok: false, error: body });
      }
    });

    socket.on('message:read', async (data) => {
      try {
        limit();
        const { messageId, conversationId } = messageReadSchema.parse(data);
        await authorize();
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
          const parsed = conversationRefSchema.safeParse(data);
          if (!parsed.success) return reject(event, parsed.error);
          await authorize();
          const room = conversationRoom(parsed.data.conversationId);
          // A room is routing state, not durable authority after membership changes.
          if (
            !socket.rooms.has(room) ||
            !(await chatService.isMember(parsed.data.conversationId, userId))
          ) {
            socket.leave(room);
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
        const { conversationId } = conversationRefSchema.parse(data);
        await authorize();
        if (!(await chatService.isMember(conversationId, userId))) {
          throw new AppError('CONVERSATION_NOT_FOUND');
        }
        socket.join(conversationRoom(conversationId));
      } catch (err) {
        reject('conversation:join', err);
      }
    });

    socket.on('conversation:leave', async (data) => {
      try {
        limit();
        const parsed = conversationRefSchema.parse(data);
        await authorize();
        socket.leave(conversationRoom(parsed.conversationId));
      } catch (err) {
        reject('conversation:leave', err);
      }
    });

    socket.on('presence:sync', async () => {
      try {
        limit();
        app.securityBudgets.take('account.presence', userId);
        await authorize();
        presence.sync(socket.id);
      } catch (err) {
        reject('presence:sync', err);
      }
    });
    if (!socket.connected) return;
    const stopPresence = presence.track({
      id: socket.id,
      userId,
      authorize,
      peers: () => chatService.getPeerIds(userId),
      send: (states, available) => {
        socket.emit('presence:snapshot', {
          states,
          availability: available ? 'available' : 'unknown',
        });
        for (const state of states) socket.emit('presence:update', state);
      },
    });
    socket.on('disconnect', () => {
      stopPresence();
      log.info({ userId }, 'Socket disconnected');
    });
  });
}
