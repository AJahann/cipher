/* oxlint-disable no-await-in-loop -- Dispatcher batches are deliberately bounded and sequential. */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Pool } from 'pg';

export const MAX_ATTEMPTS = 3;
export const jobId = (id: string, generation: number) => `${id}-g${generation}`;
interface Event {
  id: string;
  message_id: string;
  generation: number;
  attempts: number;
}
export const notificationPayloadSchema = z
  .object({
    eventId: z.uuid(),
    generation: z.number().int().min(0).max(2_147_483_647),
  })
  .strict();
type Payload = z.infer<typeof notificationPayloadSchema>;
export interface NotificationOptions {
  redisUrl?: string;
  namespace: string;
  pool: Pool;
  notify: (messageId: string) => Promise<void>;
  /** Only injected by tests; no HTTP control routes. */
  afterEnqueue?: () => Promise<void>;
  beforeEffect?: () => Promise<void>;
  afterEffect?: () => Promise<void>;
  leaseMs?: number;
  reconcileMs?: number;
  lockMs?: number;
  autoDispatch?: boolean;
  autoRun?: boolean;
}

/** Separate queue policy: workers need blocking/reconnecting connections. */
function connection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  if (!['redis:', 'rediss:'].includes(parsed.protocol))
    throw new Error('INVALID_QUEUE_REDIS_URL');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    connectTimeout: 1000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 250, 2000),
  };
}

export class NotificationJobs {
  readonly queue: Queue<Payload> | null;
  readonly worker: Worker<Payload> | null;
  private readonly timer: ReturnType<typeof setInterval> | null;
  private dispatching = false;
  private closing = false;
  private readonly leaseMs: number;
  private readonly reconcileMs: number;

  constructor(private readonly options: NotificationOptions) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.reconcileMs = options.reconcileMs ?? 30_000;
    if (!options.redisUrl) {
      this.queue = null;
      this.worker = null;
      this.timer = null;
      return;
    }
    const prefix = `${options.namespace}:jobs:v1`;
    this.queue = new Queue<Payload>('message-notification', {
      prefix,
      connection: {
        ...connection(options.redisUrl),
        maxRetriesPerRequest: 1,
        commandTimeout: 1000,
      },
    });
    this.worker = new Worker<Payload>(
      'message-notification',
      (job) =>
        this.process(job).catch(() => {
          throw new Error('NOTIFICATION_ATTEMPT_FAILED');
        }),
      {
        prefix,
        connection: connection(options.redisUrl),
        concurrency: 4,
        autorun: options.autoRun ?? true,
        maxStalledCount: 2,
        lockDuration: options.lockMs ?? 30_000,
        stalledInterval: options.lockMs ?? 30_000,
      },
    );
    // Never log URLs, arbitrary error strings, credentials or message contents.
    this.queue.on('error', () => {});
    this.worker.on('error', () => {});
    this.timer =
      options.autoDispatch === false
        ? null
        : setInterval(() => {
            void this.dispatch().catch(() => {});
          }, 1000);
    this.timer?.unref();
  }

  async dispatch() {
    if (!this.queue || this.closing || this.dispatching) return;
    this.dispatching = true;
    try {
      // SQL state, not Redis retention/dedup windows, is the recovery authority.
      const { rows } =
        await this.options.pool.query<Event>(`SELECT id, message_id, generation, attempts FROM notification_outbox
        WHERE status='pending' AND next_dispatch_at <= now() AND next_attempt_at <= now()
        AND (lease_until IS NULL OR lease_until < now()) ORDER BY next_dispatch_at, id LIMIT 25`);
      for (const event of rows) {
        if (event.attempts >= MAX_ATTEMPTS) {
          await this.options.pool.query(
            `UPDATE notification_outbox SET status='failed', last_error='ATTEMPTS_EXHAUSTED', lease_token=NULL, lease_until=NULL,
            failures=failures || jsonb_build_array(jsonb_build_object('generation',generation,'attempts',attempts,'reason','ATTEMPTS_EXHAUSTED','at',now()))
            WHERE id=$1 AND generation=$2 AND status='pending' AND (lease_until IS NULL OR lease_until < now())`,
            [event.id, event.generation],
          );
          continue;
        }
        const id = jobId(event.id, event.generation);
        const existing = await this.queue.getJob(id);
        const state = await existing?.getState();
        if (existing && (state === 'completed' || state === 'failed'))
          await existing.remove();
        await this.queue.add(
          'notify-message',
          { eventId: event.id, generation: event.generation },
          {
            jobId: id,
            attempts: MAX_ATTEMPTS,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: false,
            removeOnFail: false,
          },
        );
        await this.options.afterEnqueue?.();
        await this.options.pool.query(
          `UPDATE notification_outbox SET dispatched_at=now(), next_dispatch_at=now()+($3 * interval '1 millisecond')
          WHERE id=$1 AND generation=$2 AND status='pending'`,
          [event.id, event.generation, this.reconcileMs],
        );
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async process(job: Job<Payload>) {
    // Validate unknown infrastructure input before destructuring or SQL work.
    const parsed = notificationPayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new Error('INVALID_NOTIFICATION_JOB');
    const { eventId, generation } = parsed.data;
    const token = randomUUID();
    const { rows } = await this.options.pool.query<Event>(
      `UPDATE notification_outbox SET attempts=attempts+1, lease_token=$3,
      lease_until=now()+($4 * interval '1 millisecond') WHERE id=$1 AND generation=$2 AND status='pending'
      AND attempts < $5 AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until < now()) RETURNING id, message_id, generation, attempts`,
      [eventId, generation, token, this.leaseMs, MAX_ATTEMPTS],
    );
    const event = rows[0];
    if (!event) {
      const current = await this.options.pool.query(
        'SELECT status, generation FROM notification_outbox WHERE id=$1',
        [eventId],
      );
      if (
        !current.rows[0] ||
        current.rows[0].generation !== generation ||
        current.rows[0].status !== 'pending'
      )
        return;
      throw new Error('NOTIFICATION_LEASE_OR_BACKOFF');
    }
    const heartbeat = setInterval(
      () => {
        void this.options.pool
          .query(
            `UPDATE notification_outbox SET lease_until=now()+($2 * interval '1 millisecond') WHERE id=$3 AND lease_token=$1 AND status='pending'`,
            [token, this.leaseMs, eventId],
          )
          .catch(() => {});
      },
      Math.max(100, Math.floor(this.leaseMs / 3)),
    );
    heartbeat.unref();
    try {
      await this.options.beforeEffect?.();
      await this.options.notify(event.message_id);
      await this.options.afterEffect?.();
      await this.options.pool.query(
        `UPDATE notification_outbox SET status='completed', completed_at=now(), last_error=NULL, lease_token=NULL, lease_until=NULL
        WHERE id=$1 AND generation=$2 AND lease_token=$3`,
        [eventId, generation, token],
      );
    } catch (_error) {
      // Finite durable side-effect attempts, even if Redis loses retry metadata.
      await this.options.pool.query(
        `UPDATE notification_outbox SET status=CASE WHEN attempts >= $4 THEN 'failed' ELSE 'pending' END,
        last_error='NOTIFICATION_ATTEMPT_FAILED', lease_token=NULL, lease_until=NULL,
        failures=CASE WHEN attempts >= $4 THEN failures || jsonb_build_array(jsonb_build_object('generation',generation,'attempts',attempts,'reason','NOTIFICATION_ATTEMPT_FAILED','at',now())) ELSE failures END,
        next_attempt_at=now()+(power(2, attempts-1)*interval '1 second')
        WHERE id=$1 AND generation=$2 AND lease_token=$3`,
        [eventId, generation, token, MAX_ATTEMPTS],
      );
      throw new Error('NOTIFICATION_ATTEMPT_FAILED', { cause: _error });
    } finally {
      clearInterval(heartbeat);
    }
  }

  async close() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    // Force only queue connections; abandoned SQL leases/retained intents recover.
    await this.worker?.close(true);
    await this.queue?.close();
  }
}
