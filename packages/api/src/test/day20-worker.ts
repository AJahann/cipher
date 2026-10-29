/** IPC-only real API fixture. Production never registers fault-control routes. */
import { buildApp } from '../app';
import { pool } from '../db';
import { sessionStore } from '../db/session';

let enqueuePause = false;
let effectPause = false;
let failures = 0;
let holdBefore = false;
const gates: (() => void)[] = [];
const {
  app,
  io,
  notificationJobs: jobs,
} = await buildApp({
  autoDispatch: false,
  autoRun: false,
  leaseMs: 1200,
  lockMs: 1200,
  reconcileMs: 500,
  beforeEffect: async () => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('SECRET-DO-NOT-RETAIN');
    }
    if (holdBefore)
      await new Promise<void>((resolve) => {
        gates.push(resolve);
      });
  },
  afterEnqueue: async () => {
    if (!enqueuePause) return;
    process.send?.({ event: 'enqueue-window' });
    await new Promise<void>(() => {});
  },
  afterEffect: async () => {
    if (!effectPause) return;
    process.send?.({ event: 'effect-window' });
    await new Promise<void>(() => {});
  },
});
await jobs.worker!.waitUntilReady();
await jobs.queue!.waitUntilReady();
const url = await app.listen({ host: '127.0.0.1', port: 0 });
process.send?.({ event: 'ready', url, pid: process.pid });
process.on('message', (message: { id: number; command: string }) => {
  void (async () => {
    switch (message.command) {
      case 'dispatch':
        await jobs.dispatch();
        return {};
      case 'resume':
        jobs.worker!.resume();
        if (!jobs.worker!.isRunning()) void jobs.worker!.run().catch(() => {});
        return {};
      case 'pause':
        await jobs.worker!.pause();
        return {};
      case 'enqueue-window':
        enqueuePause = true;
        return {};
      case 'effect-window':
        effectPause = true;
        return {};
      case 'hold-before':
        holdBefore = true;
        return {};
      case 'release-before':
        holdBefore = false;
        for (const gate of gates.splice(0)) gate();
        return {};
      case 'fail-one':
        failures = 1;
        return {};
      case 'fail-three':
        failures = 3;
        return {};
      case 'stats':
        return {
          waiting: await jobs.queue!.getWaitingCount(),
          active: await jobs.queue!.getActiveCount(),
        };
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
    () => process.send?.({ id: message.id, error: 'TEST_COMMAND_FAILED' }),
  );
});
