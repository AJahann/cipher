import { FastifyRequest, FastifyReply } from 'fastify';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session.userId) {
    return reply.code(401).send({ error: 'Not authenticated' });
  }
}
