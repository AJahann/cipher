import type { FastifyInstance } from 'fastify';
import {
  listUsersQuerySchema,
  userIdParamsSchema,
} from '@chat-app/shared/contracts';
import { userService } from './user.service';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../../http/errors';
import { decodeCursor } from '../../http/cursor';

export const userController = (app: FastifyInstance) => {
  app.addHook('preHandler', requireAuth);

  /** GET /users?limit=&cursor= — directory, everyone except the caller. */
  app.get('/', async (req, reply) => {
    const { limit, cursor } = listUsersQuerySchema.parse(req.query);
    // Validate cursor semantics even on a cache hit, not only its string shape.
    const cursorId = cursor
      ? decodeCursor('users', cursor).toLowerCase()
      : undefined;
    const result = await app.directoryCache.read(
      { caller: req.session.userId!, limit, cursorId },
      () => userService.listUsers(req.session.userId!, limit, cursor),
    );
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Directory-Cache', result.cache);
    return reply.send(result.page);
  });

  app.get('/:id/public-key', async (req, reply) => {
    const { id } = userIdParamsSchema.parse(req.params);
    const key = await userService.getPublicKey(id);
    if (!key) throw new AppError('USER_NOT_FOUND');
    return reply.send({ publicKey: key });
  });
};
