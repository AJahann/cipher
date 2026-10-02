import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorSchema } from '@chat-app/shared/contracts';
import { AppError, STATUS_BY_CODE, toApiError } from './errors';
import { decodeCursor, encodeCursor } from './cursor';

const ID = '33333333-3333-4333-8333-333333333333';

describe(toApiError, () => {
  it('maps an AppError to its status and the shared envelope', () => {
    const { status, body } = toApiError(new AppError('CONVERSATION_NOT_FOUND'));

    expect(status).toBe(404);
    expect(body).toEqual({
      code: 'CONVERSATION_NOT_FOUND',
      message: 'Conversation not found',
    });
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it('maps a ZodError to 400 VALIDATION_FAILED with issue paths', () => {
    const result = z.object({ memberId: z.uuid() }).safeParse({ memberId: 1 });
    const { status, body } = toApiError(result.error);

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.issues?.[0]?.path).toEqual(['memberId']);
  });

  it('maps Fastify client errors by status', () => {
    const tooLarge = Object.assign(new Error('Body too large'), {
      statusCode: 413,
    });
    expect(toApiError(tooLarge)).toMatchObject({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('never leaks the message of an unexpected error', () => {
    const { status, body } = toApiError(new Error('pg: connection refused'));

    expect(status).toBe(500);
    expect(body).toEqual({
      code: 'INTERNAL',
      message: 'Internal server error',
    });
  });

  it('gives every error code a status', () => {
    for (const status of Object.values(STATUS_BY_CODE)) {
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('cursor', () => {
  it('round-trips an id for the same list kind', () => {
    expect(decodeCursor('messages', encodeCursor('messages', ID))).toBe(ID);
  });

  it('rejects a cursor minted for a different list', () => {
    expect(() => decodeCursor('messages', encodeCursor('users', ID))).toThrow(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    );
  });

  it.each(['', 'not-base64!', Buffer.from('{"v":1}').toString('base64url')])(
    'rejects a malformed cursor %j',
    (cursor) => {
      expect(() => decodeCursor('users', cursor)).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
    },
  );
});
