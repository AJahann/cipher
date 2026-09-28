import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { conversationMembers } from './user';
import { messages } from './message';

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Canonical sorted member key for direct-message idempotency. */
  directKey: text('direct_key').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const conversationsRelations = relations(conversations, ({ many }) => ({
  members: many(conversationMembers),
  messages: many(messages),
}));
