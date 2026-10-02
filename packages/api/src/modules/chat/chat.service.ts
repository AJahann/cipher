import { db } from '../../db';
import {
  messages,
  conversations,
  conversationMembers,
  messageReads,
} from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { SendMessageInput } from '@chat-app/shared/contracts';
import { AppError } from '../../http/errors';
import { decodeCursor, encodeCursor } from '../../http/cursor';

function directConversationKey(memberIds: string[]) {
  return `dm:${[...memberIds].sort().join(':')}`;
}

type MessageRow = typeof messages.$inferSelect;

export const chatService = {
  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
      ),
    });
    return Boolean(membership);
  },

  /**
   * Get-or-create the direct conversation between two distinct users.
   * `conversations.direct_key` is UNIQUE, so concurrent callers converge on
   * one row; `created` tells the caller which of them inserted it.
   */
  getOrCreateDirectConversation(userId: string, memberId: string) {
    if (userId === memberId) {
      return Promise.reject(new AppError('INVALID_MEMBER'));
    }
    const sortedIds = [userId, memberId].sort();
    const directKey = directConversationKey(sortedIds);

    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(conversations)
        .values({ directKey })
        .onConflictDoNothing({ target: conversations.directKey })
        .returning();

      if (created) {
        await tx.insert(conversationMembers).values(
          sortedIds.map((id) => ({
            conversationId: created.id,
            userId: id,
          })),
        );
        return { conversation: created, created: true };
      }

      const [existing] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.directKey, directKey));

      if (!existing) throw new Error('CONVERSATION_CREATE_CONFLICT');
      return { conversation: existing, created: false };
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

  /**
   * Idempotent on (senderId, clientMessageId). A retry with the same key and
   * the same payload returns the stored row with `replayed: true`; the same
   * key with a different payload is IDEMPOTENCY_CONFLICT. Keys never expire.
   */
  async sendMessage(
    data: SendMessageInput & { senderId: string },
  ): Promise<{ message: MessageRow; replayed: boolean }> {
    if (!(await chatService.isMember(data.conversationId, data.senderId))) {
      throw new AppError('CONVERSATION_NOT_FOUND');
    }

    const [inserted] = await db
      .insert(messages)
      .values(data)
      .onConflictDoNothing({
        target: [messages.senderId, messages.clientMessageId],
      })
      .returning();

    if (inserted) return { message: inserted, replayed: false };

    const existing = await db.query.messages.findFirst({
      where: and(
        eq(messages.senderId, data.senderId),
        eq(messages.clientMessageId, data.clientMessageId),
      ),
    });

    if (!existing) throw new Error('MESSAGE_IDEMPOTENCY_LOOKUP_FAILED');

    const sameCommand =
      existing.conversationId === data.conversationId &&
      existing.ciphertext === data.ciphertext &&
      existing.nonce === data.nonce &&
      existing.algorithm === data.algorithm;

    if (!sameCommand) throw new AppError('IDEMPOTENCY_CONFLICT');
    return { message: existing, replayed: true };
  },

  /**
   * Keyset page, newest first by `(created_at DESC, id DESC)` — `id` breaks
   * ties so the order is total. The cursor names the oldest message already
   * returned; its sort key is resolved inside Postgres so microsecond
   * precision never round-trips through a JS Date. Items in a page are
   * returned oldest → newest for rendering.
   */
  async getMessages(
    conversationId: string,
    requesterId: string,
    limit: number,
    cursor?: string,
  ) {
    if (!(await chatService.isMember(conversationId, requesterId))) {
      throw new AppError('CONVERSATION_NOT_FOUND');
    }

    let anchorId: string | undefined;
    if (cursor) {
      anchorId = decodeCursor('messages', cursor);
      const anchor = await db.query.messages.findFirst({
        where: and(
          eq(messages.id, anchorId),
          eq(messages.conversationId, conversationId),
        ),
        columns: { id: true },
      });
      if (!anchor) throw new AppError('INVALID_CURSOR');
    }

    const rows = await db.query.messages.findMany({
      where: (m, { and: allOf, eq: equals }) =>
        allOf(
          equals(m.conversationId, conversationId),
          anchorId
            ? sql`(${m.createdAt}, ${m.id}) < (select anchor.created_at, anchor.id from messages anchor where anchor.id = ${anchorId})`
            : undefined,
        ),
      orderBy: (m, { desc }) => [desc(m.createdAt), desc(m.id)],
      limit: limit + 1,
      with: {
        sender: { columns: { id: true, username: true } },
      },
    });

    const page = rows.slice(0, limit);
    const oldest = page.at(-1);
    return {
      items: page.reverse(),
      nextCursor:
        rows.length > limit && oldest
          ? encodeCursor('messages', oldest.id)
          : null,
    };
  },

  /** Records a read receipt. Idempotent via UNIQUE(message_id, user_id). */
  async markRead(messageId: string, conversationId: string, userId: string) {
    if (!(await chatService.isMember(conversationId, userId))) {
      throw new AppError('CONVERSATION_NOT_FOUND');
    }
    const message = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.conversationId, conversationId),
      ),
      columns: { id: true },
    });
    if (!message) throw new AppError('MESSAGE_NOT_FOUND');

    await db
      .insert(messageReads)
      .values({ messageId, userId })
      .onConflictDoNothing();
    return { messageId, userId };
  },
};
