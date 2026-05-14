import { z } from 'zod';

export const createConversationSchema = z.object({
  memberId: z.string().uuid(),
});

export const getMessagesSchema = z.object({
  conversationId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().uuid().optional(), // cursor: message ID
});

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  algorithm: z.string().min(1),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type GetMessagesInput = z.infer<typeof getMessagesSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
