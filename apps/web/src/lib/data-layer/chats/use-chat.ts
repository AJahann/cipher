import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Conversation, Message } from '@chat-app/shared/types';
import { apiFetch } from '../client';

export interface MessagesQueryParams {
  conversationId?: string;
  limit?: number;
  before?: string;
}

export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  /**
   * Prefix for cache lookups and invalidation.
   *
   * Never filter with `messages(id)`: React Query compares the params object
   * with `partialDeepEqual`, and `{ limit: undefined }` does not match a cached
   * `{ limit: 50 }`. Filtering by a partially-filled key silently matches
   * nothing. Filter on this prefix and narrow on `conversationId` yourself.
   */
  messagesRoot: () => [...chatKeys.all, 'messages'] as const,
  messages: (conversationId?: string, limit?: number, before?: string) =>
    [...chatKeys.messagesRoot(), { conversationId, limit, before }] as const,
};

interface CreateConversationPayload {
  memberId: string;
}

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
    enabled: Boolean(conversationId),
  });
}
