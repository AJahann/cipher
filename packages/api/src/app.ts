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

export const buildApp = async () => {
  const app = Fastify({
    logger: {
      // Authorization codes/state must not enter application access logs.
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url?.split('?')[0],
            hostname: req.hostname,
            remoteAddress: req.ip,
          };
        },
      },
    },
  });

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
  app.addHook('onClose', (_instance, done) => {
    presence.close();
    redis.close();
    done();
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
    allowRequest: (req, accept) =>
      accept(null, req.headers.origin === env.CLIENT_ORIGIN),
    cors: {
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    },
  });

  io = socketServer;

  registerChatSocket(socketServer, app.log, sessionStore, { app, presence });

  return { app, io: socketServer };
};
