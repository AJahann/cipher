import { db } from '../../db';
import {
  messages,
  conversations,
  conversationMembers,
  messageReads,
} from '../../db/schema';
import { eq, lt, and, desc, sql, inArray } from 'drizzle-orm';

export const chatService = {
  async createConversation(memberIds: string[]) {
    const sortedIds = [...memberIds].sort();
    const memberCount = sortedIds.length;

    const existing = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(inArray(conversationMembers.userId, sortedIds))
      .groupBy(conversationMembers.conversationId)
      .having(
        sql`COUNT(*) = ${memberCount} AND COUNT(*) = (
          SELECT COUNT(*) FROM ${conversationMembers} cm2
          WHERE cm2.conversation_id = ${conversationMembers.conversationId}
        )`,
      );

    if (existing.length > 0) {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, existing[0].conversationId));
      return conv!;
    }

    return db.transaction(async (tx) => {
      const [conv] = await tx.insert(conversations).values({}).returning();
      await tx
        .insert(conversationMembers)
        .values(
          sortedIds.map((userId) => ({ conversationId: conv.id, userId })),
        );
      return conv;
    });
  },

  async listConversations(userId: string) {
    const memberships = await db.query.conversationMembers.findMany({
      where: eq(conversationMembers.userId, userId),
      with: {
        conversation: {
          with: {
            members: {
              with: {
                user: { columns: { id: true, username: true } },
              },
            },
          },
        },
      },
    });
    return memberships.map((m) => m.conversation);
  },

  async getConversationIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(eq(conversationMembers.userId, userId));
    return rows.map((r) => r.conversationId);
  },

  async getConversationMembers(conversationId: string): Promise<string[]> {
    const rows = await db.query.conversationMembers.findMany({
      where: eq(conversationMembers.conversationId, conversationId),
      columns: { userId: true },
    });
    return rows.map((r) => r.userId);
  },

  async sendMessage(data: {
    conversationId: string;
    senderId: string;
    ciphertext: string;
    nonce: string;
    algorithm: string;
  }) {
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(conversationMembers.conversationId, data.conversationId),
        eq(conversationMembers.userId, data.senderId),
      ),
    });
    if (!membership) throw new Error('FORBIDDEN');

    const [message] = await db.insert(messages).values(data).returning();
    return message!;
  },

  async getMessages(
    conversationId: string,
    requesterId: string,
    limit: number,
    before?: string,
  ) {
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, requesterId),
      ),
    });
    if (!membership) throw new Error('FORBIDDEN');

    let cursorCondition;
    if (before) {
      const cursor = await db.query.messages.findFirst({
        where: eq(messages.id, before),
      });
      if (cursor) {
        cursorCondition = lt(messages.createdAt, cursor.createdAt);
      }
    }

    const rows = await db.query.messages.findMany({
      where: and(eq(messages.conversationId, conversationId), cursorCondition),
      orderBy: [desc(messages.createdAt)],
      limit,
      with: {
        sender: { columns: { id: true, username: true } },
      },
    });
    return rows.reverse();
  },

  async markRead(messageId: string, userId: string) {
    await db
      .insert(messageReads)
      .values({ messageId, userId })
      .onConflictDoNothing();
    return { messageId, userId };
  },
};
