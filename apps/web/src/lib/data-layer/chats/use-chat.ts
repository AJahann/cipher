import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Conversation } from '@chat-app/shared/types';
import type { MessagesPage } from '@chat-app/shared/contracts';
import { apiFetch } from '../client';

export interface MessagesQueryParams {
  conversationId?: string;
  limit?: number;
  /** Opaque `nextCursor` from a previous page; omit for the newest page. */
  cursor?: string;
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
  messages: (conversationId?: string, limit?: number, cursor?: string) =>
    [...chatKeys.messagesRoot(), { conversationId, limit, cursor }] as const,
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

/**
 * The cache holds the page's `items` (oldest → newest) so realtime writers can
 * append to a plain array. `nextCursor` is not surfaced yet: the UI has no
 * "load older" control (tracked in docs/api-spec.md).
 */
const getMessages = async (
  conversationId: string,
  limit?: number,
  cursor?: string,
) => {
  const params = new URLSearchParams();
  params.set('conversationId', conversationId);
  if (limit) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  const page = await apiFetch<MessagesPage>(`/chat/messages?${params}`);
  return page.items;
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
  cursor?: string,
) {
  return useQuery({
    queryKey: chatKeys.messages(conversationId, limit, cursor),
    queryFn: () => getMessages(conversationId!, limit, cursor),
    enabled: Boolean(conversationId),
  });
}
