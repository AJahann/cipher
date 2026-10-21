import { useMemo } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
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
  historyRoot: () => [...chatKeys.all, 'history'] as const,
  history: (conversationId: string, accountId: string) =>
    [...chatKeys.historyRoot(), { conversationId, accountId }] as const,
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
 * Legacy single-page helper retained for compatibility. Its cache holds
 * items oldest → newest; the production UI uses useMessageHistory to retain
 * cursor metadata and load older pages without corrupting their boundaries.
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

/** HTTP pages remain authoritative. Realtime invalidates; it never inserts new
 * messages into historical cursor pages or makes page arrays grow unbounded. */
export function useMessageHistory(conversationId: string, accountId: string) {
  const query = useInfiniteQuery({
    queryKey: chatKeys.history(conversationId, accountId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ conversationId, limit: '50' });
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<MessagesPage>(`/chat/messages?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(conversationId && accountId),
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return query.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.items)
      .filter((message) => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      });
  }, [query.data]);
  return { ...query, data: items };
}
