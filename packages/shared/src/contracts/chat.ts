import { z } from 'zod';
import { apiErrorSchema } from './errors';
import { cursorSchema, pageLimitSchema, pageSchema } from './pagination';
import { userSummarySchema } from './user';

/** Upper bound on an encrypted payload field (base64). */
export const MAX_CIPHERTEXT_LENGTH = 65_536;

// ── send message (socket `message:send`) ─────────────────────────────────────

export const sendMessageSchema = z.object({
  /**
   * Idempotency key, generated once per logical message on the client and
   * reused verbatim on every retry. Scoped to the sender; never expires.
   */
  clientMessageId: z.uuid(),
  conversationId: z.uuid(),
  ciphertext: z.string().min(1).max(MAX_CIPHERTEXT_LENGTH),
  nonce: z.string().min(1).max(256),
  algorithm: z.string().min(1).max(64),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const messageSchema = z.object({
  id: z.uuid(),
  clientMessageId: z.uuid(),
  conversationId: z.uuid(),
  senderId: z.uuid(),
  ciphertext: z.string(),
  nonce: z.string(),
  algorithm: z.string(),
  /** ISO-8601 UTC timestamp assigned by the server. */
  createdAt: z.string(),
  sender: userSummarySchema,
});
export type MessageDto = z.infer<typeof messageSchema>;

export const sendMessageAckSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    message: messageSchema,
    /** True when this clientMessageId was already stored (a retry). */
    replayed: z.boolean(),
  }),
  z.object({ ok: z.literal(false), error: apiErrorSchema }),
]);
export type SendMessageAck = z.infer<typeof sendMessageAckSchema>;

// ── conversations ───────────────────────────────────────────────────────────

export const createConversationSchema = z.object({ memberId: z.uuid() });
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const conversationSchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
});
export type ConversationDto = z.infer<typeof conversationSchema>;

// ── message history ─────────────────────────────────────────────────────────

export const listMessagesQuerySchema = z.object({
  conversationId: z.uuid(),
  limit: pageLimitSchema.default(50),
  cursor: cursorSchema.optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const messagesPageSchema = pageSchema(messageSchema);
export type MessagesPage = z.infer<typeof messagesPageSchema>;

// ── other client → server socket events ─────────────────────────────────────

export const conversationRefSchema = z.object({ conversationId: z.uuid() });
export type ConversationRef = z.infer<typeof conversationRefSchema>;

export const messageReadSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
});
export type MessageReadInput = z.infer<typeof messageReadSchema>;
