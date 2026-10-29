import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { messages } from './message';

/** Durable notification intent; completion is NOT a peer delivery/read receipt. */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    generation: integer('generation').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    nextDispatchAt: timestamp('next_dispatch_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    failures: jsonb('failures').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    messageUnique: unique('notification_outbox_message_unique').on(t.messageId),
    pending: index('notification_outbox_pending_idx')
      .on(t.nextDispatchAt)
      .where(sql`${t.status} = 'pending'`),
  }),
);
