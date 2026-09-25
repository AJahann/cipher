import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  User,
  RegisterUserPayload,
  LoginUserPayload,
} from '@chat-app/shared/types';
import { apiFetch } from '../client';

export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  /**
   * Prefix for cache lookups and invalidation.
   *
   * `list()` embeds a params object, and React Query's `partialDeepEqual` will
   * not match `{ limit: undefined }` against a cached `{ limit: 50 }`. Always
   * invalidate on this prefix so paginated variants are covered too.
   */
  listRoot: () => [...userKeys.all, 'list'] as const,
  list: (limit?: number, after?: string) =>
    [...userKeys.listRoot(), { limit, after }] as const,
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

/** GET /users returns a bare array — there is no envelope or cursor yet. */
type UsersListResponse = User[];

const listUsers = (limit?: number, after?: string) => {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (after) params.set('after', after);
  const qs = params.toString();
  return apiFetch<UsersListResponse>(`/users${qs ? `?${qs}` : ''}`);
};

const getPublicKey = (userId: string) =>
  apiFetch<{ publicKey: string }>(`/users/${userId}/public-key`);

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
    onSuccess: () => {
      qc.removeQueries({ queryKey: userKeys.me() });
    },
  });
}

export function useUsersList(limit?: number, after?: string) {
  return useQuery({
    queryKey: userKeys.list(limit, after),
    queryFn: () => listUsers(limit, after),
  });
}

export function useUserPublicKey(userId?: string) {
  return useQuery({
    queryKey: userKeys.publicKey(userId ?? ''),
    queryFn: () => getPublicKey(userId!),
    enabled: !!userId,
  });
}
