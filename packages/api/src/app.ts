import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env';
import { authController } from './modules/auth/auth.controller';
import { userController } from './modules/user/user.controller';
import { chatController } from './modules/chat/chat.controller';
import { registerChatSocket } from './modules/chat/chat.socket';
import { sessionStore } from './db/session';

export const buildApp = async () => {
  const app = Fastify({ logger: true });

  // Socket.IO can only attach once the HTTP server is ready, but the REST
  // handlers registered below need to emit on it at request time (e.g. telling
  // connected clients that a new account was created). A getter decorator hands
  // them a late-bound reference instead of capturing `null` forever.
  let io: SocketIOServer | null = null;
  app.decorate('io', { getter: () => io });

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
    saveUninitialized: false,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(authController, { prefix: '/auth' });
  app.register(userController, { prefix: '/users' });
  app.register(chatController, { prefix: '/chat' });

  await app.ready();

  const socketServer = new SocketIOServer(app.server, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    },
  });

  io = socketServer;

  registerChatSocket(socketServer, app.log, sessionStore, app);

  return { app, io: socketServer };
};
