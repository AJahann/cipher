import { buildApp } from './app';
import { env } from './config/env';

const start = async () => {
  const { app } = await buildApp();

  await app.listen({ port: Number(env.BACKEND_PORT), host: '0.0.0.0' });

  console.log(`Server running on port ${env.BACKEND_PORT}`);
  console.log(`  REST:      http://localhost:${env.BACKEND_PORT}`);
  console.log(`  Socket.IO: ws://localhost:${env.BACKEND_PORT}`);
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
