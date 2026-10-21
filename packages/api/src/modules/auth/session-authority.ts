import type { FastifyInstance } from 'fastify';
import { destroySession } from '../../db/session';

export const sessionRoom = (id: string) => `session:${id}`;

/** Remove the store authority before closing every transport that captured it. */
export async function revokeSession(app: FastifyInstance, id: string) {
  await destroySession(id);
  app.io?.in(sessionRoom(id)).disconnectSockets(true);
}
