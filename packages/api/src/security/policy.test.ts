import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { Writable } from 'node:stream';
import { SecurityBudgets } from './policy';
import { securityLogger } from './logging';
import { registerErrorHandling } from '../http/errors';
import {
  notificationPayloadSchema,
  NotificationJobs,
} from '../jobs/notification-jobs';
import { redrive } from '../jobs/operations';
import type { Job } from 'bullmq';
import type { Pool } from 'pg';

it('shares account windows across connections, isolates identities and recovers', () => {
  let now = 0;
  const budgets = new SecurityBudgets(() => now);
  for (let i = 0; i < 120; i++) budgets.take('account.event', 'one');
  expect(() => budgets.take('account.event', 'one')).toThrow(
    'Too many requests',
  );
  expect(() => budgets.take('account.event', 'two')).not.toThrow();
  now = 10_000;
  expect(() => budgets.take('account.event', 'one')).not.toThrow();
});

it('bounds live tabs and process-wide recurring work; releases exactly once', () => {
  const budgets = new SecurityBudgets();
  const releases = Array.from({ length: 8 }, () => budgets.connect('one'));
  expect(() => budgets.connect('one')).toThrow('Too many requests');
  releases[0]();
  releases[0]();
  budgets.connect('one');
  expect(() => budgets.connect('one')).toThrow('Too many requests');
  for (let i = 0; i < 248; i++) budgets.connect(`other-${i}`);
  expect(() => budgets.connect('new')).toThrow('Too many requests');
});

describe('untrusted job metadata', () => {
  it.each(
    [
      null,
      [],
      {},
      { eventId: 'not-uuid', generation: 0 },
      { eventId: '33333333-3333-4333-8333-333333333333', generation: -1 },
      { eventId: '33333333-3333-4333-8333-333333333333', generation: 2 ** 31 },
      {
        eventId: '33333333-3333-4333-8333-333333333333',
        generation: 0,
        ciphertext: 'unexpected',
      },
    ].map((data) => ({ data })),
  )('rejects malformed metadata before SQL: %j', async ({ data }) => {
    expect(notificationPayloadSchema.safeParse(data).success).toBe(false);
    const query = vi.fn();
    const jobs = new NotificationJobs({
      namespace: 'unit',
      pool: { query } as unknown as Pool,
      notify: vi.fn(),
    });
    // Exercise the actual consumer boundary without requiring Redis; no job can claim SQL.
    const consumer = jobs as unknown as {
      process: (job: Job) => Promise<void>;
    };
    await expect(consumer.process({ data } as Job)).rejects.toThrow(
      'INVALID_NOTIFICATION_JOB',
    );
    expect(query).not.toHaveBeenCalled();
    await jobs.close();
  });
  it('validates operator helper arguments before SQL', async () => {
    const query = vi.fn();
    await expect(redrive({ query } as unknown as Pool, 'bad')).rejects.toThrow(
      'Invalid UUID',
    );
    expect(query).not.toHaveBeenCalled();
  });
});

it('actual HTTP access/error logs omit credentials, bodies and OAuth queries', async () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const app = Fastify({ logger: { ...securityLogger, stream } });
  registerErrorHandling(app);
  app.post('/callback', () =>
    Promise.reject(new Error('synthetic-private-key-marker')),
  );
  const response = await app.inject({
    method: 'POST',
    url: '/callback?code=synthetic-code-marker&state=synthetic-state-marker',
    headers: {
      cookie: 'sessionId=synthetic-cookie-marker',
      authorization: 'Bearer synthetic-token-marker',
    },
    payload: {
      password: 'synthetic-password-marker',
      privateKey: 'synthetic-private-key-marker',
    },
  });
  expect(response.statusCode).toBe(500);
  await app.close();
  const output = lines.join('');
  expect(output).toContain('Request failed');
  for (const marker of [
    'code',
    'state',
    'cookie',
    'token',
    'password',
    'private-key',
  ])
    expect(output).not.toContain(`synthetic-${marker}-marker`);
  expect(response.body).not.toContain('synthetic');
});
