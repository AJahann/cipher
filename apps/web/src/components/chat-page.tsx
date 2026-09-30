'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chatKeys, useMessages } from '@/lib/data-layer/chats';
import { useUserPublicKey } from '@/lib/data-layer/user';
import {
  type SendMessageData,
  useChatSocketActions,
  useChatRealtimeMessages,
} from '@/lib/data-layer/chats/use-chat-socket';
import { E2EEncryption, getSessionPrivateKey } from '@chat-app/shared/crypto';
import { KeyStorage } from '@/lib/keyStorage';
import { KeyManager } from '@chat-app/shared';
import {
  ChatHeader,
  ChatInput,
  MessageList,
  type DecryptedMessage,
} from '@chat-app/ui-web';

function formatTime(ts?: string | number | Date) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

type PendingMessage = {
  id: string;
  text: string;
  time: string;
  status: 'sending' | 'sent' | 'failed';
  payload: SendMessageData;
};

export function ChatPage({
  conversationId,
  receiverId,
  myId,
  isConnected,
}: {
  conversationId: string;
  receiverId: string;
  myId: string;
  isConnected: boolean;
}) {
  const qc = useQueryClient();
  const { sendMessage, typingStart, typingStop } = useChatSocketActions();
  const {
    data: messages,
    isLoading: messagesIsLoading,
    isError,
  } = useMessages(conversationId);
  useChatRealtimeMessages();

  const { data: receiverKey, isLoading } = useUserPublicKey(receiverId);
  const [input, setInput] = useState('');
  const [decrypted, setDecrypted] = useState<DecryptedMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;

    async function run() {
      try {
        const sessionPrivateKey = getSessionPrivateKey();
        const myPublicKeyRaw = await KeyStorage.loadPublicKeyRaw();
        const receiverKeyRaw = receiverKey?.publicKey
          ? await KeyManager.fromBase64(receiverKey.publicKey)
          : null;

        if (!myPublicKeyRaw || !receiverKeyRaw) {
          if (!cancelled) setDecrypted([]);
          return;
        }

        const out = await Promise.all(
          (messages ?? []).map(async (m): Promise<DecryptedMessage | null> => {
            try {
              const plain = await E2EEncryption.decryptMessage(
                m.ciphertext,
                m.nonce,
                receiverKeyRaw,
                sessionPrivateKey,
              );
              return {
                id: m.id,
                clientMessageId: m.clientMessageId,
                senderId: m.senderId,
                text: plain,
                time: formatTime(m.createdAt),
                isMine: m.senderId === myId,
                deliveryStatus: 'sent',
              };
            } catch {
              return null;
            }
          }),
        );

        if (!cancelled) {
          setDecrypted(out.filter((x): x is DecryptedMessage => x !== null));
        }
      } catch {
        if (!cancelled) setDecrypted([]);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [isLoading, messages, myId, receiverKey?.publicKey]);

  useEffect(() => {
    const confirmedIds = new Set(
      decrypted
        .map((message) => message.clientMessageId)
        .filter((id): id is string => Boolean(id)),
    );
    if (confirmedIds.size === 0) return;

    setPending((current) => {
      const next = current.filter((item) => !confirmedIds.has(item.id));
      return next.length === current.length ? current : next;
    });
  }, [decrypted]);

  async function deliver(item: PendingMessage) {
    setComposerError(null);
    setPending((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, status: 'sending' }
          : candidate,
      ),
    );

    try {
      await sendMessage(item.payload);
      setPending((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, status: 'sent' }
            : candidate,
        ),
      );
      void qc.invalidateQueries({ queryKey: chatKeys.messagesRoot() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FAILED_TO_SEND';
      setComposerError(message);
      setPending((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, status: 'failed' }
            : candidate,
        ),
      );
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !receiverKey?.publicKey || !isConnected) return;

    try {
      const senderPrivateKeyRaw = getSessionPrivateKey();
      const receiverKeyRaw = await KeyManager.fromBase64(receiverKey.publicKey);
      const ciphertext = await E2EEncryption.encryptMessage(
        text,
        receiverKeyRaw,
        senderPrivateKeyRaw,
      );
      const clientMessageId = crypto.randomUUID();
      const item: PendingMessage = {
        id: clientMessageId,
        text,
        time: formatTime(new Date()),
        status: 'sending',
        payload: { clientMessageId, conversationId, ...ciphertext },
      };

      setPending((current) => [...current, item]);
      setInput('');
      void deliver(item);
    } catch {
      setComposerError('ENCRYPTION_FAILED');
    }
  }

  function handleTyping(value: string) {
    setInput(value);
    if (value.trim()) typingStart(conversationId);
    else typingStop(conversationId);
  }

  const confirmedIds = new Set(
    decrypted
      .map((message) => message.clientMessageId)
      .filter((id): id is string => Boolean(id)),
  );
  const visiblePending = pending.filter((item) => !confirmedIds.has(item.id));

  const visibleMessages: DecryptedMessage[] = [
    ...decrypted,
    ...visiblePending.map((item) => ({
      id: item.id,
      clientMessageId: item.id,
      senderId: myId,
      text: item.text,
      time: item.time,
      isMine: true,
      deliveryStatus: item.status,
    })),
  ];

  return (
    <main className='flex flex-1 min-w-0 flex-col'>
      <ChatHeader isConnected={isConnected} />
      <MessageList
        isLoading={messagesIsLoading}
        isError={isError}
        loadingMessage='decrypting messages...'
        messages={visibleMessages}
        onRetryMessage={(id) => {
          const item = pending.find((candidate) => candidate.id === id);
          if (item) void deliver(item);
        }}
      />
      {composerError && (
        <p role='status' className='px-4 py-2 text-xs text-red-400'>
          Message not sent: {composerError}. Retry from the message bubble.
        </p>
      )}
      {!isConnected && (
        <p role='status' className='sr-only'>
          Reconnecting. Message sending is temporarily unavailable.
        </p>
      )}
      <ChatInput
        value={input}
        onChange={handleTyping}
        onSend={handleSend}
        disabled={!isConnected}
        placeholder={isConnected ? 'Write a message...' : 'Reconnecting...'}
      />
    </main>
  );
}
