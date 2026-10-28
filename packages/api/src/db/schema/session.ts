import { index, json, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// Matches connect-pg-simple's storage contract. Schema creation belongs to
// migrations, not the application's runtime database role.
export const userSessions = pgTable(
  'user_sessions',
  {
    sid: varchar('sid').primaryKey(),
    sess: json('sess').notNull(),
    expire: timestamp('expire', { precision: 6 }).notNull(),
  },
  (table) => [index('IDX_session_expire').on(table.expire)],
);

// Revoked IDs never become valid again, even if an older response saves later.
export const sessionRevocations = pgTable('session_revocations', {
  sid: varchar('sid').primaryKey(),
  revokedAt: timestamp('revoked_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
