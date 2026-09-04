import '@fastify/session';
import type { Server as SocketIOServer } from 'socket.io';

declare module '@fastify/session' {
  interface FastifySessionObject {
    userId?: string;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Socket.IO server. Attached only after `app.ready()`, because it needs the
     * underlying HTTP server. REST handlers registered before that point read it
     * through a getter decorator, so always access it optionally (`app.io?.…`).
     */
    io: SocketIOServer | null;
  }
}
