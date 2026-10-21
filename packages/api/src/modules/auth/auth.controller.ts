import type { FastifyInstance } from 'fastify';
import {
  loginUserSchema,
  registerUserSchema,
} from '@chat-app/shared/contracts';
import { userService } from '../user/user.service';
import { requireAuth } from './auth.middleware';
import { AppError } from '../../http/errors';
import { destroySession } from '../../db/session';

export const authController = (app: FastifyInstance) => {
  app.post('/register', async (req, reply) => {
    const body = registerUserSchema.parse(req.body);
    const user = await userService.register(body);
    const previousSessionId = req.session.sessionId;
    await req.session.regenerate();
    // @fastify/session regenerates without deleting the old store row.
    await destroySession(previousSessionId);
    req.session.userId = user.id;
    await req.session.save();

    // The contact list is the user directory, so every connected client needs
    // to know it changed. Without this their list stays at whatever it was when
    // they logged in until they refresh the page.
    app.io?.emit('user:new', { id: user.id, username: user.username });

    return reply.code(201).send(user);
  });

  app.post('/login', async (req, reply) => {
    const body = loginUserSchema.parse(req.body);
    const user = await userService.login(body);
    const previousSessionId = req.session.sessionId;
    await req.session.regenerate();
    // @fastify/session regenerates without deleting the old store row.
    await destroySession(previousSessionId);
    req.session.userId = user.id;
    await req.session.save();
    return reply.send(user);
  });

  app.post('/logout', { preHandler: requireAuth }, async (req, reply) => {
    await req.session.destroy();
    return reply.send({ ok: true });
  });

  app.get('/key-bundle', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.send(await userService.getKeyBundle(req.session.userId!));
  });

  app.get('/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await userService.findById(req.session.userId!);
    if (!user) {
      // The account behind this session is gone: the session is dead too.
      await req.session.destroy();
      reply.clearCookie('sessionId', { path: '/' });
      throw new AppError('UNAUTHENTICATED');
    }
    return reply.send(user);
  });
};
