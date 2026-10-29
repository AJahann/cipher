/**
 * IPC-only test fixture. This file is never registered as an HTTP route and is
 * launched by the integration test in TWO separate Node API processes.
 */
import { buildApp } from '../app';
import { pool } from '../db';
import { sessionStore } from '../db/session';
import { userService } from '../modules/user/user.service';

let reads = 0;
let pause = false;
let release: (() => void) | undefined;
const original = userService.listUsers.bind(userService);
userService.listUsers = async (...args) => {
  reads += 1;
  const result = await original(...args);
  if (pause) {
    pause = false;
    await new Promise<void>((resolve) => {
      release = resolve;
      process.send?.({ event: 'fill-paused' });
    });
  }
  return result;
};

const { app, io } = await buildApp();
const url = await app.listen({ port: 0, host: '127.0.0.1' });
process.send?.({ event: 'ready', url, pid: process.pid });

process.on('message', (message: { id: number; command: string }) => {
  void (async () => {
    switch (message.command) {
      case 'stats':
        return {
          reads,
          pid: process.pid,
          redisReady: app.redisRuntime.presenceReady ? 1 : 0,
        };
      case 'pause-fill':
        pause = true;
        return {};
      case 'release-fill':
        release?.();
        release = undefined;
        return {};
      case 'subscriber-down':
        app.redisRuntime.subscriber?.disconnect();
        return {};
      case 'subscriber-up':
        await app.redisRuntime.subscriber?.connect();
        return {};
      case 'stop':
        await new Promise<void>((resolve) => io.close(() => resolve()));
        await app.close();
        sessionStore.close();
        await pool.end();
        return {};
      default:
        throw new Error('UNKNOWN_TEST_COMMAND');
    }
  })().then(
    (result) => {
      process.send?.({ id: message.id, result });
      if (message.command === 'stop') process.disconnect?.();
    },
    (error: unknown) => {
      process.send?.({ id: message.id, error: String(error) });
    },
  );
});
