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
