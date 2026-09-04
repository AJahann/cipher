import { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { userService } from '../user/user.service';
import { registerUserSchema, loginUserSchema } from '../user/user.schema';
import { requireAuth } from './auth.middleware';

export const authController = async (app: FastifyInstance) => {
  app.post('/register', async (req, reply) => {
    const body = registerUserSchema.parse(req.body);
    const user = await userService.register(body);
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
    req.session.userId = user.id;
    await req.session.save();
    return reply.send(user);
  });

  app.post('/logout', { preHandler: requireAuth }, async (req, reply) => {
    await req.session.destroy();
    return reply.send({ ok: true });
  });

  app.get('/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await userService.findById(req.session.userId!);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    app.log.info({ userId: req.session.userId }, 'HTTP session check');
    return reply.send(user);
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: 'Validation failed', issues: error.issues });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'USERNAME_TAKEN') {
      return reply.code(409).send({ error: 'Username already taken' });
    }
    if (message === 'INVALID_CREDENTIALS') {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
};
