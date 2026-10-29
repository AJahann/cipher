import {
  check,
  foreignKey,
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
    messageId: uuid('message_id').notNull(),
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
    // Match PostgreSQL's existing names from the hand-written 0007 migration.
    messageForeignKey: foreignKey({
      name: 'notification_outbox_message_id_fkey',
      columns: [t.messageId],
      foreignColumns: [messages.id],
    }).onDelete('cascade'),
    statusCheck: check(
      'notification_outbox_status_check',
      sql`${t.status} IN ('pending', 'completed', 'failed')`,
    ),
    generationCheck: check(
      'notification_outbox_generation_check',
      sql`${t.generation} >= 0`,
    ),
    attemptsCheck: check(
      'notification_outbox_attempts_check',
      sql`${t.attempts} BETWEEN 0 AND 3`,
    ),
    messageUnique: unique('notification_outbox_message_unique').on(t.messageId),
    pending: index('notification_outbox_pending_idx')
      .on(t.nextDispatchAt)
      .where(sql`${t.status} = 'pending'`),
  }),
);
