import type { FastifyRequest, FastifyReply } from 'fastify';

// oxlint-disable-next-line require-await
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session.userId) {
    return reply.code(401).send({ error: 'Not authenticated' });
  }
}
