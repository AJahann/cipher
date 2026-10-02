import type { FastifyRequest } from 'fastify';
import { AppError } from '../../http/errors';

// oxlint-disable-next-line require-await
export async function requireAuth(req: FastifyRequest) {
  if (!req.session.userId) throw new AppError('UNAUTHENTICATED');
}
