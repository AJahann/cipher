import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { conversations } from './conversation';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    // Cursor directory: id range/order plus username without reading the heap.
    // id remains the complete ordering key; username only provides coverage.
    directory: index('users_directory_id_username_idx').on(t.id, t.username),
  }),
);

export const userKeys = pgTable('user_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(),
  wrappedPrivateKey: text('wrapped_private_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const conversationMembers = pgTable(
  'conversation_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    // A user is a member of a conversation at most once.
    memberUniq: unique().on(t.conversationId, t.userId),
    // Socket bootstrap projects conversationId; cover it after the user filter.
    // This replaces the narrower user_id index, not the membership constraint.
    byUser: index('conversation_members_user_conversation_idx').on(
      t.userId,
      t.conversationId,
    ),
  }),
);

export const usersRelations = relations(users, ({ one, many }) => ({
  key: one(userKeys, {
    fields: [users.id],
    references: [userKeys.userId],
  }),
  memberships: many(conversationMembers),
}));

export const userKeysRelations = relations(userKeys, ({ one }) => ({
  user: one(users, {
    fields: [userKeys.userId],
    references: [users.id],
  }),
}));

export const conversationMembersRelations = relations(
  conversationMembers,
  ({ one }) => ({
    user: one(users, {
      fields: [conversationMembers.userId],
      references: [users.id],
    }),
    conversation: one(conversations, {
      fields: [conversationMembers.conversationId],
      references: [conversations.id],
    }),
  }),
);
