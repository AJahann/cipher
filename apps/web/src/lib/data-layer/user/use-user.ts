import { useMemo } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import type {
  User,
  RegisterUserPayload,
  LoginUserPayload,
} from '@chat-app/shared/types';
import type { UserSummary, UsersPage } from '@chat-app/shared/contracts';
import { apiFetch } from '../client';
import { clearClientSession } from '../../client-session';

export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  githubLinkStatus: (id?: string) =>
    [...userKeys.all, 'githubLinkStatus', id] as const,
  /**
   * Prefix for cache lookups and invalidation.
   *
   * `list()` embeds a params object, and React Query's `partialDeepEqual` will
   * not match `{ limit: undefined }` against a cached `{ limit: 50 }`. Always
   * invalidate on this prefix so paginated variants are covered too.
   */
  directoryRoot: () => [...userKeys.all, 'directory'] as const,
  listRoot: () => [...userKeys.all, 'list'] as const,
  list: (limit?: number, cursor?: string) =>
    [...userKeys.listRoot(), { limit, cursor }] as const,
  publicKey: (id: string) => [...userKeys.all, 'publicKey', id] as const,
};

const fetchMe = () => apiFetch<User>('/auth/me');

const register = (payload: RegisterUserPayload) =>
  apiFetch<User>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

const login = (payload: LoginUserPayload) =>
  apiFetch<User>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

const logout = () => apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' });

/**
 * GET /users is cursor-paginated. The directory currently renders only the
 * first page (`limit` up to 100); see docs/api-spec.md for the follow-up.
 */
const listUsers = async (
  limit?: number,
  cursor?: string,
): Promise<UserSummary[]> => {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  const page = await apiFetch<UsersPage>(`/users${qs ? `?${qs}` : ''}`);
  return page.items;
};

const getPublicKey = (userId: string) =>
  apiFetch<{ publicKey: string }>(`/users/${userId}/public-key`);

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => apiFetch<{ githubEnabled: boolean }>('/auth/config'),
    retry: false,
    staleTime: 0,
  });
}

export function useGitHubLinkStatus(userId?: string, enabled = false) {
  return useQuery({
    queryKey: userKeys.githubLinkStatus(userId),
    queryFn: () => apiFetch<{ linked: boolean }>('/auth/github/status'),
    enabled: enabled && Boolean(userId),
    retry: false,
    staleTime: 0,
  });
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: userKeys.me(),
    queryFn: fetchMe,
    enabled,
    retry: false,
    // AuthGuard establishes this identity before the protected chat tree
    // mounts. Keep that result fresh long enough for consumers in the tree to
    // reuse it instead of issuing a second /auth/me request.
    staleTime: 30_000,
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: register,
    onSuccess: (user) => {
      qc.setQueryData(userKeys.me(), user);
      qc.invalidateQueries({ queryKey: userKeys.listRoot() });
    },
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      qc.setQueryData(userKeys.me(), user);
      qc.invalidateQueries({ queryKey: userKeys.listRoot() });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await clearClientSession(qc);
    },
  });
}

export function useUsersList(limit?: number, cursor?: string) {
  return useQuery({
    queryKey: userKeys.list(limit, cursor),
    queryFn: () => listUsers(limit, cursor),
  });
}

export function useUserPublicKey(userId?: string) {
  return useQuery({
    queryKey: userKeys.publicKey(userId ?? ''),
    queryFn: () => getPublicKey(userId!),
    enabled: Boolean(userId),
  });
}

export function useDirectory(accountId?: string) {
  const query = useInfiniteQuery({
    queryKey: [...userKeys.directoryRoot(), accountId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '100' });
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<UsersPage>(`/users?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(accountId),
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return query.data?.pages
      .flatMap((page) => page.items)
      .filter((user) => {
        if (seen.has(user.id)) return false;
        seen.add(user.id);
        return true;
      });
  }, [query.data]);
  return { ...query, data: items };
}
