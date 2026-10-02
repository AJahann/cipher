import { apiErrorSchema } from '@chat-app/shared/contracts';
import { env } from '../../config/env';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: unknown[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // Every API error uses the shared envelope `{ code, message, issues? }`.
    const raw = await res.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(raw);
    if (parsed.success) {
      const { code, message, issues } = parsed.data;
      throw new ApiError(res.status, code, message, issues);
    }
    throw new ApiError(res.status, 'UNKNOWN', `HTTP ${res.status}`);
  }

  // 204 No Content — return undefined cast to T
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}
