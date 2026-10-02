import { describe, expect, it } from 'vitest';
import {
  listMessagesQuerySchema,
  sendMessageAckSchema,
  sendMessageSchema,
} from './index';

const valid = {
  clientMessageId: '44444444-4444-4444-8444-444444444444',
  conversationId: '33333333-3333-4333-8333-333333333333',
  ciphertext: 'ciphertext-a',
  nonce: 'nonce-a',
  algorithm: 'x25519-xsalsa20-poly1305',
};

describe('send-message payload contract', () => {
  it('accepts a well-formed payload', () => {
    expect(sendMessageSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['clientMessageId', 'not-a-uuid'],
    ['ciphertext', ''],
    ['ciphertext', 'x'.repeat(65_537)],
    ['algorithm', 'a'.repeat(65)],
  ])('rejects an invalid %s', (field, value) => {
    expect(
      sendMessageSchema.safeParse({ ...valid, [field]: value }).success,
    ).toBe(false);
  });
});

describe('send-message ack contract', () => {
  it('requires an error envelope on failure', () => {
    expect(
      sendMessageAckSchema.safeParse({ ok: false, error: 'FAILED_TO_SEND' })
        .success,
    ).toBe(false);
    expect(
      sendMessageAckSchema.safeParse({
        ok: false,
        error: { code: 'IDEMPOTENCY_CONFLICT', message: 'x' },
      }).success,
    ).toBe(true);
  });
});

describe('message history query contract', () => {
  it('coerces limit from the query string and defaults it to 50', () => {
    const id = valid.conversationId;
    expect(listMessagesQuerySchema.parse({ conversationId: id })).toEqual({
      conversationId: id,
      limit: 50,
    });
    expect(
      listMessagesQuerySchema.parse({ conversationId: id, limit: '10' }).limit,
    ).toBe(10);
    expect(
      listMessagesQuerySchema.safeParse({ conversationId: id, limit: '101' })
        .success,
    ).toBe(false);
  });
});
