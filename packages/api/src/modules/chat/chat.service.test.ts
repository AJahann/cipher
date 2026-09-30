import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  let sequence = 0;
  const messageRows = new Map<string, Record<string, unknown>>();
  const conversationsByKey = new Map<string, Record<string, unknown>>();
  const membershipRows: Record<string, unknown>[] = [];

  const db: any = {
    query: {
      conversationMembers: {
        findFirst: vi.fn(async () => ({ id: 'membership' })),
        findMany: vi.fn(async () => []),
      },
      messages: {
        findFirst: vi.fn(async () => messageRows.values().next().value),
      },
    },
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(db),
    ),
    select: vi.fn(() => ({
      from: () => ({
        where: async () => {
          const conversation = conversationsByKey.values().next().value;
          return conversation ? [conversation] : [];
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: (values: any) => {
        if (Array.isArray(values)) {
          membershipRows.push(...values);
          return Promise.resolve();
        }

        if ('clientMessageId' in values) {
          return {
            onConflictDoNothing: () => ({
              returning: async () => {
                const key = `${values.senderId}:${values.clientMessageId}`;
                if (messageRows.has(key)) return [];

                const row = {
                  ...values,
                  id: `message-${++sequence}`,
                  createdAt: new Date('2026-01-01T00:00:00.000Z'),
                };
                messageRows.set(key, row);
                return [row];
              },
            }),
          };
        }

        if ('directKey' in values) {
          return {
            onConflictDoNothing: () => ({
              returning: async () => {
                if (conversationsByKey.has(values.directKey)) return [];

                const row = {
                  id: `conversation-${++sequence}`,
                  directKey: values.directKey,
                  createdAt: new Date('2026-01-01T00:00:00.000Z'),
                };
                conversationsByKey.set(values.directKey, row);
                return [row];
              },
            }),
          };
        }

        return {
          onConflictDoNothing: () => Promise.resolve(),
          returning: async () => [],
        };
      },
    })),
  };

  return {
    db,
    messageRows,
    conversationsByKey,
    membershipRows,
    reset() {
      sequence = 0;
      messageRows.clear();
      conversationsByKey.clear();
      membershipRows.length = 0;
      vi.clearAllMocks();
    },
  };
});

vi.mock('../../db', () => ({ db: testState.db }));

import { chatService } from './chat.service';

const senderId = '11111111-1111-4111-8111-111111111111';
const receiverId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const clientMessageId = '44444444-4444-4444-8444-444444444444';

const command = {
  clientMessageId,
  conversationId,
  senderId,
  ciphertext: 'ciphertext-a',
  nonce: 'nonce-a',
  algorithm: 'x25519-xsalsa20-poly1305',
};

describe('chatService idempotency', () => {
  beforeEach(() => testState.reset());

  it('returns the original message for the same sender, key, and payload', async () => {
    const first = await chatService.sendMessage(command);
    const retried = await chatService.sendMessage({ ...command });

    expect(retried).toEqual(first);
    expect(testState.messageRows.size).toBe(1);
  });

  it('rejects reuse of the same sender and key with a different payload', async () => {
    await chatService.sendMessage(command);

    await expect(
      chatService.sendMessage({
        ...command,
        ciphertext: 'different-ciphertext',
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');

    expect(testState.messageRows.size).toBe(1);
  });

  it('returns one conversation for two concurrent direct-message requests', async () => {
    const [first, second] = await Promise.all([
      chatService.createConversation([senderId, receiverId]),
      chatService.createConversation([receiverId, senderId]),
    ]);

    expect(second.id).toBe(first.id);
    expect(testState.conversationsByKey.size).toBe(1);
    expect(testState.membershipRows).toHaveLength(2);
  });
});
