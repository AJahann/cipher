import { buildApp } from './app';
import { env } from './config/env';
import { pool } from './db';
import { sessionStore } from './db/session';

const start = async () => {
  const { app, io } = await buildApp();
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down API server');
    try {
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await app.close();
      sessionStore.close();
      await pool.end();
      process.exit(0);
    } catch (_error) {
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  await app.listen({ port: Number(env.BACKEND_PORT), host: '0.0.0.0' });

  console.log(`Server running on port ${env.BACKEND_PORT}`);
  console.log(`  REST:      http://localhost:${env.BACKEND_PORT}`);
  console.log(`  Socket.IO: ws://localhost:${env.BACKEND_PORT}`);
};

start().catch(() => {
  console.error(
    'API startup failed; inspect deployment configuration and service health.',
  );
  process.exit(1);
});
