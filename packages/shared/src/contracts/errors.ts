import { z } from 'zod';

/**
 * Every error the API can produce, over HTTP or Socket.IO. The HTTP status for
 * each code is fixed by the server (see packages/api/src/http/errors.ts) and
 * documented in docs/api-spec.md. Clients branch on `code`, never on `message`.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'BAD_REQUEST',
  'INVALID_CURSOR',
  'INVALID_MEMBER',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'USER_NOT_FOUND',
  'CONVERSATION_NOT_FOUND',
  'MESSAGE_NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'USERNAME_TAKEN',
  'IDEMPOTENCY_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const validationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/** The single error envelope: HTTP error bodies and failed socket acks. */
export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  /** Present only for VALIDATION_FAILED. */
  issues: z.array(validationIssueSchema).optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
