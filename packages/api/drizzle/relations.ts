import { relations } from "drizzle-orm/relations";
import { conversations, conversationMembers, users, userKeys, messages, messageReads } from "./schema";

export const conversationMembersRelations = relations(conversationMembers, ({one}) => ({
	conversation: one(conversations, {
		fields: [conversationMembers.conversationId],
		references: [conversations.id]
	}),
	user: one(users, {
		fields: [conversationMembers.userId],
		references: [users.id]
	}),
}));

export const conversationsRelations = relations(conversations, ({many}) => ({
	conversationMembers: many(conversationMembers),
	messages: many(messages),
}));

export const usersRelations = relations(users, ({many}) => ({
	conversationMembers: many(conversationMembers),
	userKeys: many(userKeys),
	messages: many(messages),
	messageReads: many(messageReads),
}));

export const userKeysRelations = relations(userKeys, ({one}) => ({
	user: one(users, {
		fields: [userKeys.userId],
		references: [users.id]
	}),
}));

export const messagesRelations = relations(messages, ({one, many}) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	}),
	user: one(users, {
		fields: [messages.senderId],
		references: [users.id]
	}),
	messageReads: many(messageReads),
}));

export const messageReadsRelations = relations(messageReads, ({one}) => ({
	message: one(messages, {
		fields: [messageReads.messageId],
		references: [messages.id]
	}),
	user: one(users, {
		fields: [messageReads.userId],
		references: [users.id]
	}),
}));