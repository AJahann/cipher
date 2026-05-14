// apps/web/src/hooks/use-chat.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Conversation, Message } from '@chat-app/shared/types'; // <- adjust path in your monorepo
import { apiFetch } from '../client';

// -----------------------------
// Query Keys
// -----------------------------
// apps/web/src/hooks/use-chat.ts
// ...
export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  messages: (conversationId?: string, limit?: number, before?: string) =>
    [...chatKeys.all, 'messages', { conversationId, limit, before }] as const,
};
// ...

// -----------------------------
// API Calls
// -----------------------------
type CreateConversationPayload = { memberId: string };

const createConversation = (payload: CreateConversationPayload) =>
  apiFetch<Conversation>('/chat/conversations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

const listConversations = () => apiFetch<Conversation[]>('/chat/conversations');

type MessagesResponse = Message[];

const getMessages = (
  conversationId: string,
  limit?: number,
  before?: string,
) => {
  const params = new URLSearchParams();
  params.set('conversationId', conversationId);
  if (limit) params.set('limit', String(limit));
  if (before) params.set('before', before);
  const qs = params.toString();
  return apiFetch<MessagesResponse>(`/chat/messages?${qs}`);
};

// -----------------------------
// Hooks
// -----------------------------
export function useConversations() {
  return useQuery({
    queryKey: chatKeys.conversations(),
    queryFn: listConversations,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createConversation,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}

export function useMessages(
  conversationId?: string,
  limit?: number,
  before?: string,
) {
  return useQuery({
    queryKey: chatKeys.messages(conversationId, limit, before),
    queryFn: () => getMessages(conversationId!, limit, before),
    enabled: !!conversationId,
  });
}
