import { pgTable, uuid, timestamp, foreignKey, unique, text } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const conversations = pgTable("conversations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const conversationMembers = pgTable("conversation_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull(),
	userId: uuid("user_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "conversation_members_conversation_id_conversations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "conversation_members_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	username: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("users_username_unique").on(table.username),
]);

export const userKeys = pgTable("user_keys", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	publicKey: text("public_key").notNull(),
	wrappedPrivateKey: text("wrapped_private_key").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_keys_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("user_keys_user_id_unique").on(table.userId),
]);

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull(),
	senderId: uuid("sender_id").notNull(),
	ciphertext: text().notNull(),
	nonce: text().notNull(),
	algorithm: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "messages_conversation_id_conversations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "messages_sender_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const messageReads = pgTable("message_reads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	messageId: uuid("message_id").notNull(),
	userId: uuid("user_id").notNull(),
	readAt: timestamp("read_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [messages.id],
			name: "message_reads_message_id_messages_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "message_reads_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("message_reads_message_id_user_id_unique").on(table.messageId, table.userId),
]);
