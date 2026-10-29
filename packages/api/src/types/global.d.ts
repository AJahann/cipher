import '@fastify/session';
import type { Server as SocketIOServer } from 'socket.io';
import type { DirectoryCache } from '../redis/directory-cache';
import type { RedisRuntime } from '../redis/runtime';

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
    directoryCache: DirectoryCache;
    redisRuntime: RedisRuntime;
  }
}
