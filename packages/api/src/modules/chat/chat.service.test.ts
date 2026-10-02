import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from './chat.service';

const testState = vi.hoisted(() => {
  let sequence = 0;
  const messageRows = new Map<string, Record<string, unknown>>();
  const conversationsByKey = new Map<string, Record<string, unknown>>();
  const membershipRows: Record<string, unknown>[] = [];

  const db: any = {
    query: {
      conversationMembers: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'membership' })),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      messages: {
        findFirst: vi.fn(() =>
          Promise.resolve(messageRows.values().next().value),
        ),
      },
    },
    transaction: vi.fn((callback: (tx: unknown) => unknown) =>
      Promise.resolve(callback(db)),
    ),
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          const conversation = conversationsByKey.values().next().value;
          return Promise.resolve(conversation ? [conversation] : []);
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
              returning: () => {
                const key = `${values.senderId}:${values.clientMessageId}`;
                if (messageRows.has(key)) return Promise.resolve([]);

                sequence += 1;
                const row = {
                  ...values,
                  id: `message-${sequence}`,
                  createdAt: new Date('2026-01-01T00:00:00.000Z'),
                };
                messageRows.set(key, row);
                return Promise.resolve([row]);
              },
            }),
          };
        }

        if ('directKey' in values) {
          return {
            onConflictDoNothing: () => ({
              returning: () => {
                if (conversationsByKey.has(values.directKey)) {
                  return Promise.resolve([]);
                }

                sequence += 1;
                const row = {
                  id: `conversation-${sequence}`,
                  directKey: values.directKey,
                  createdAt: new Date('2026-01-01T00:00:00.000Z'),
                };
                conversationsByKey.set(values.directKey, row);
                return Promise.resolve([row]);
              },
            }),
          };
        }

        return {
          onConflictDoNothing: () => Promise.resolve(),
          returning: () => Promise.resolve([]),
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

vi.mock(import('../../db'), () => ({ db: testState.db }));

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

  it('stores a first send and reports it as not replayed', async () => {
    const first = await chatService.sendMessage(command);

    expect(first.replayed).toBe(false);
    expect(first.message).toMatchObject({ clientMessageId, senderId });
  });

  it('returns the original message, flagged replayed, for an identical retry', async () => {
    const first = await chatService.sendMessage(command);
    const retried = await chatService.sendMessage({ ...command });

    expect(retried.message).toEqual(first.message);
    expect(retried.replayed).toBe(true);
    expect(testState.messageRows.size).toBe(1);
  });

  it('rejects reuse of the same sender and key with a different payload', async () => {
    await chatService.sendMessage(command);

    await expect(
      chatService.sendMessage({
        ...command,
        ciphertext: 'different-ciphertext',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    expect(testState.messageRows.size).toBe(1);
  });

  it('answers a non-member with CONVERSATION_NOT_FOUND and stores nothing', async () => {
    testState.db.query.conversationMembers.findFirst.mockResolvedValueOnce(
      undefined,
    );

    await expect(chatService.sendMessage(command)).rejects.toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
    });
    expect(testState.messageRows.size).toBe(0);
  });
});

describe('chatService direct conversations', () => {
  beforeEach(() => testState.reset());

  it('returns one conversation for two concurrent direct-message requests', async () => {
    const [first, second] = await Promise.all([
      chatService.getOrCreateDirectConversation(senderId, receiverId),
      chatService.getOrCreateDirectConversation(receiverId, senderId),
    ]);

    expect(second.conversation.id).toBe(first.conversation.id);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(testState.conversationsByKey.size).toBe(1);
    expect(testState.membershipRows).toHaveLength(2);
  });

  it('reports created=false when the conversation already exists', async () => {
    const first = await chatService.getOrCreateDirectConversation(
      senderId,
      receiverId,
    );
    const again = await chatService.getOrCreateDirectConversation(
      senderId,
      receiverId,
    );

    expect(first.created).toBe(true);
    expect(again).toEqual({ conversation: first.conversation, created: false });
  });

  it('refuses a conversation with yourself', async () => {
    await expect(
      chatService.getOrCreateDirectConversation(senderId, senderId),
    ).rejects.toMatchObject({ code: 'INVALID_MEMBER' });
    expect(testState.conversationsByKey.size).toBe(0);
  });
});

describe('chatService history access', () => {
  beforeEach(() => testState.reset());

  it('hides a conversation from non-members behind CONVERSATION_NOT_FOUND', async () => {
    testState.db.query.conversationMembers.findFirst.mockResolvedValueOnce(
      undefined,
    );

    await expect(
      chatService.getMessages(conversationId, receiverId, 50),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });
});
