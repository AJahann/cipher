import type { FastifyInstance } from 'fastify';
import {
  listUsersQuerySchema,
  userIdParamsSchema,
} from '@chat-app/shared/contracts';
import { userService } from './user.service';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../../http/errors';

export const userController = (app: FastifyInstance) => {
  app.addHook('preHandler', requireAuth);

  /** GET /users?limit=&cursor= — directory, everyone except the caller. */
  app.get('/', async (req, reply) => {
    const { limit, cursor } = listUsersQuerySchema.parse(req.query);
    const page = await userService.listUsers(
      req.session.userId!,
      limit,
      cursor,
    );
    return reply.send(page);
  });

  app.get('/:id/public-key', async (req, reply) => {
    const { id } = userIdParamsSchema.parse(req.params);
    const key = await userService.getPublicKey(id);
    if (!key) throw new AppError('USER_NOT_FOUND');
    return reply.send({ publicKey: key });
  });
};
