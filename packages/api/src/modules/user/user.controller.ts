import { FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';
import { userService } from './user.service';
import { requireAuth } from '../auth/auth.middleware';

export const userController = async (app: FastifyInstance) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req, reply) => {
    const { limit, after } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        after: z.string().uuid().optional(),
      })
      .parse(req.query);

    const result = await userService.listUsers(
      req.session.userId!,
      limit,
      after,
    );
    return reply.send(result);
  });

  app.get('/:id/public-key', async (req, reply) => {
    const { id } = req.params as { id: string };
    const key = await userService.getPublicKey(id);
    if (!key) return reply.code(404).send({ error: 'User not found' });
    return reply.send({ publicKey: key });
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: 'Validation failed', issues: error.issues });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
};
