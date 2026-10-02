import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody, ErrorCode } from '@chat-app/shared/contracts';

/** HTTP status for each error code. The one place this mapping lives. */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  BAD_REQUEST: 400,
  INVALID_CURSOR: 400,
  INVALID_MEMBER: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  USER_NOT_FOUND: 404,
  CONVERSATION_NOT_FOUND: 404,
  MESSAGE_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Validation failed',
  BAD_REQUEST: 'Bad request',
  INVALID_CURSOR: 'Cursor is invalid or does not belong to this list',
  INVALID_MEMBER: 'Cannot start a conversation with yourself',
  UNAUTHENTICATED: 'Not authenticated',
  INVALID_CREDENTIALS: 'Invalid credentials',
  USER_NOT_FOUND: 'User not found',
  CONVERSATION_NOT_FOUND: 'Conversation not found',
  MESSAGE_NOT_FOUND: 'Message not found',
  ROUTE_NOT_FOUND: 'Route not found',
  USERNAME_TAKEN: 'Username already taken',
  IDEMPOTENCY_CONFLICT:
    'clientMessageId was already used for a different message',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',
  INTERNAL: 'Internal server error',
};

/** Domain error carrying a machine-readable code. Throw this, never strings. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string = DEFAULT_MESSAGE[code],
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status() {
    return STATUS_BY_CODE[this.code];
  }
}

function fromFastifyStatus(status: number): ErrorCode {
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === 404) return 'ROUTE_NOT_FOUND';
  if (status === 401) return 'UNAUTHENTICATED';
  return 'BAD_REQUEST';
}

/** Normalise anything thrown into `{ status, body }` with the one envelope. */
export function toApiError(error: unknown): {
  status: number;
  body: ApiErrorBody;
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { code: error.code, message: error.message },
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        code: 'VALIDATION_FAILED',
        message: DEFAULT_MESSAGE.VALIDATION_FAILED,
        issues: error.issues.map((issue) => ({
          path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
          message: issue.message,
        })),
      },
    };
  }
  // Fastify's own client errors (malformed JSON, body too large, …).
  const status = (error as FastifyError | undefined)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = fromFastifyStatus(status);
    return {
      status,
      body: {
        code,
        message: (error as Error).message || DEFAULT_MESSAGE[code],
      },
    };
  }
  return {
    status: 500,
    body: { code: 'INTERNAL', message: DEFAULT_MESSAGE.INTERNAL },
  };
}

/** Registered once on the root instance so every route shares it. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error, req, reply) => {
    const { status, body } = toApiError(error);
    if (status >= 500) req.log.error(error);
    return reply.code(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ApiErrorBody = {
      code: 'ROUTE_NOT_FOUND',
      message: `${req.method} ${req.url} does not exist`,
    };
    return reply.code(404).send(body);
  });
}

/** Postgres unique_violation, possibly wrapped by drizzle. */
export function isUniqueViolation(error: unknown, constraint?: string) {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  return candidates.some((e) => {
    const pg = e as { code?: string; constraint?: string } | undefined;
    return (
      pg?.code === '23505' &&
      (constraint === undefined || pg.constraint === constraint)
    );
  });
}
