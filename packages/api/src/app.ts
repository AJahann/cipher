import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env';
import { githubController } from './modules/auth/github.controller';
import { authController } from './modules/auth/auth.controller';
import { userController } from './modules/user/user.controller';
import { chatController } from './modules/chat/chat.controller';
import { registerChatSocket } from './modules/chat/chat.socket';
import { sessionStore } from './db/session';
import { registerErrorHandling } from './http/errors';
import { RedisRuntime } from './redis/runtime';
import { DirectoryCache } from './redis/directory-cache';
import { Presence } from './redis/presence';
import {
  NotificationJobs,
  type NotificationOptions,
} from './jobs/notification-jobs';
import { messageNotifier } from './jobs/notify-message';
import { pool } from './db';
import {
  HTTP_BODY_BYTES,
  SOCKET_PAYLOAD_BYTES,
  SecurityBudgets,
} from './security/policy';
import { registerHttpSecurity } from './security/http';
import { securityLogger } from './security/logging';

export const buildApp = async (
  jobOptions: Partial<
    Pick<
      NotificationOptions,
      | 'beforeEffect'
      | 'afterEnqueue'
      | 'afterEffect'
      | 'leaseMs'
      | 'reconcileMs'
      | 'lockMs'
      | 'autoDispatch'
      | 'autoRun'
    >
  > = {},
  securityOptions: { now?: () => number } = {},
) => {
  const app = Fastify({
    bodyLimit: HTTP_BODY_BYTES,
    trustProxy: false, // No forwarded IP authority without a reviewed proxy policy.
    logger: securityLogger,
  });

  const budgets = new SecurityBudgets(securityOptions.now);
  app.decorate('securityBudgets', budgets);
  registerHttpSecurity(app, budgets, env.CLIENT_ORIGIN);

  // Socket.IO can only attach once the HTTP server is ready, but the REST
  // handlers registered below need to emit on it at request time (e.g. telling
  // connected clients that a new account was created). A getter decorator hands
  // them a late-bound reference instead of capturing `null` forever.
  let io: SocketIOServer | null = null;
  app.decorate('io', { getter: () => io });
  const redis = new RedisRuntime(env.REDIS_URL, env.REDIS_NAMESPACE);
  const presence = new Presence(redis, env.PRESENCE_LEASE_MS);
  app.decorate('redisRuntime', redis);
  app.decorate('directoryCache', new DirectoryCache(redis));
  app.addHook('onClose', async () => {
    await notificationJobs.close();
    presence.close();
    redis.close();
  });

  // One error envelope for every route, registered before any plugin.
  registerErrorHandling(app);

  await app.register(cors, {
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  });

  app.register(cookie, {
    secret: env.SESSION_SECRET,
  });
  app.register(session, {
    secret: env.SESSION_SECRET,

    store: sessionStore,
    cookieName: 'sessionId',
    cookie: {
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      sameSite: 'lax',
    },
    // Preserve sliding expiry; the store prevents stale saves after revocation.
    rolling: true,
    saveUninitialized: false,
  });

  app.get('/health', () => ({ status: 'ok' }));

  app.register(authController, { prefix: '/auth' });
  app.register(githubController, { prefix: '/auth/github' });
  app.register(userController, { prefix: '/users' });
  app.register(chatController, { prefix: '/chat' });

  await app.ready();

  const socketServer = new SocketIOServer(app.server, {
    maxHttpBufferSize: SOCKET_PAYLOAD_BYTES,
    perMessageDeflate: false,
    allowRequest: (req, accept) => {
      try {
        budgets.take('ip.handshake', req.socket.remoteAddress ?? 'unknown');
        accept(null, req.headers.origin === env.CLIENT_ORIGIN);
      } catch (_error) {
        accept(null, false);
      }
    },
    cors: {
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    },
  });

  io = socketServer;

  registerChatSocket(socketServer, app.log, sessionStore, { app, presence });

  const notificationJobs = new NotificationJobs({
    ...jobOptions,
    redisUrl: env.REDIS_URL,
    namespace: env.REDIS_NAMESPACE,
    pool,
    notify: messageNotifier(socketServer, sessionStore),
  });
  return { app, io: socketServer, notificationJobs };
};
