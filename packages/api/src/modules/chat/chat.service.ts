import { createHash } from 'node:crypto';
import { db } from '../../db';
import {
  messages,
  conversations,
  conversationMembers,
  messageReads,
} from '../../db/schema';
import { eq, lt, and, desc, sql, inArray } from 'drizzle-orm';

function directConversationKey(memberIds: string[]) {
  return `dm:${[...memberIds].sort().join(':')}`;
}

function messageCommandId(data: {
  senderId: string;
  conversationId: string;
  ciphertext: string;
  nonce: string;
  algorithm: string;
}) {
  const hex = createHash('sha256')
    .update(data.senderId)
    .update('\0')
    .update(data.conversationId)
    .update('\0')
    .update(data.ciphertext)
    .update('\0')
    .update(data.nonce)
    .update('\0')
    .update(data.algorithm)
    .digest('hex')
    .slice(0, 32)
    .split('');

  // Format the deterministic digest as an RFC 4122-compatible UUID.
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export const chatService = {
  async createConversation(memberIds: string[]) {
    const sortedIds = [...new Set(memberIds)].sort();
    const memberCount = sortedIds.length;

    if (memberCount === 2) {
      const directKey = directConversationKey(sortedIds);

      return db.transaction(async (tx) => {
        const [created] = await tx
          .insert(conversations)
          .values({ directKey })
          .onConflictDoNothing({ target: conversations.directKey })
          .returning();

        if (created) {
          await tx.insert(conversationMembers).values(
            sortedIds.map((userId) => ({
              conversationId: created.id,
              userId,
            })),
          );
          return created;
        }

        const [existing] = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.directKey, directKey));

        if (!existing) throw new Error('CONVERSATION_CREATE_CONFLICT');
        return existing;
      });
    }

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
      await tx.insert(conversationMembers).values(
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
    clientMessageId?: string;
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

    const clientMessageId = data.clientMessageId ?? messageCommandId(data);
    const values = { ...data, clientMessageId };

    const [inserted] = await db
      .insert(messages)
      .values(values)
      .onConflictDoNothing({
        target: [messages.senderId, messages.clientMessageId],
      })
      .returning();

    if (inserted) return inserted;

    const existing = await db.query.messages.findFirst({
      where: and(
        eq(messages.senderId, data.senderId),
        eq(messages.clientMessageId, clientMessageId),
      ),
    });

    if (!existing) throw new Error('MESSAGE_IDEMPOTENCY_LOOKUP_FAILED');

    const sameCommand =
      existing.conversationId === data.conversationId &&
      existing.ciphertext === data.ciphertext &&
      existing.nonce === data.nonce &&
      existing.algorithm === data.algorithm;

    if (!sameCommand) throw new Error('IDEMPOTENCY_CONFLICT');
    return existing;
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
      if (cursor) cursorCondition = lt(messages.createdAt, cursor.createdAt);
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
