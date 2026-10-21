import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './user';
import { userSessions } from './session';

// Stable provider id, never username/email, is the identity boundary.
export const githubIdentities = pgTable('github_identities', {
  githubUserId: text('github_user_id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
});

// A single pending flow per session. DELETE RETURNING consumes it atomically,
// including across workers; session-store read/modify/write is not sufficient.
export const githubOAuthAttempts = pgTable(
  'github_oauth_attempts',
  {
    sessionId: varchar('session_id')
      .primaryKey()
      .references(() => userSessions.sid, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    verifier: text('verifier').notNull(),
    linkUserId: uuid('link_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('github_oauth_attempts_expiry_idx').on(table.expiresAt)],
);
