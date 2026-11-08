import { apiErrorSchema } from '@chat-app/shared/contracts';
import { getApiOrigin } from './api-origin';
import { startWebSpan } from '../telemetry/tracer';

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
  const method = (init?.method ?? 'GET').toUpperCase();
  const route = path.split('?')[0];
  const span = startWebSpan(`web.fetch ${method} ${route}`, {
    attributes: {
      'http.method': method,
      'http.url': path,
      'http.route': route,
    },
  });

  const headers = new Headers(init?.headers);
  span.injectHeaders(headers);

  // Only serialized JSON bodies get a default JSON content type. A bodyless
  // POST (GitHub linking/logout) must not trigger Fastify's empty-JSON parser.
  // FormData/Blob/etc. retain their browser-generated or explicit content type.
  if (typeof init?.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const res = await fetch(`${getApiOrigin()}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });

    if (!res.ok) {
      span.end('error', `HTTP ${res.status}`);
      // Every API error uses the shared envelope `{ code, message, issues? }`.
      const raw = await res.json().catch(() => null);
      const parsed = apiErrorSchema.safeParse(raw);
      if (parsed.success) {
        const { code, message, issues } = parsed.data;
        throw new ApiError(res.status, code, message, issues);
      }
      throw new ApiError(res.status, 'UNKNOWN', `HTTP ${res.status}`);
    }

    span.end('ok');

    // 204 No Content — return undefined cast to T
    if (res.status === 204) return undefined as T;

    return res.json() as Promise<T>;
  } catch (error) {
    span.end('error', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
