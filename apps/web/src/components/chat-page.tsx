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

type MessagesData = ReturnType<typeof useMessages>['data'];
type EncryptedMessage = NonNullable<MessagesData>[number];

interface PendingMessage {
  id: string;
  text: string;
  time: string;
  status: 'sending' | 'sent' | 'failed';
  payload: SendMessageData;
}

interface ChatPageProps {
  conversationId: string;
  receiverId: string;
  receiverName: string;
  myId: string;
  isConnected: boolean;
}

function getConfirmedIds(messages: DecryptedMessage[]) {
  return new Set(
    messages
      .map((message) => message.clientMessageId)
      .filter((id): id is string => Boolean(id)),
  );
}

async function decryptOne(
  message: EncryptedMessage,
  receiverKeyRaw: Uint8Array,
  sessionPrivateKey: ReturnType<typeof getSessionPrivateKey>,
  myId: string,
): Promise<DecryptedMessage | null> {
  try {
    const plain = await E2EEncryption.decryptMessage(
      message.ciphertext,
      message.nonce,
      receiverKeyRaw,
      sessionPrivateKey,
    );
    return {
      id: message.id,
      clientMessageId: message.clientMessageId,
      senderId: message.senderId,
      text: plain,
      time: formatTime(message.createdAt),
      isMine: message.senderId === myId,
      deliveryStatus: 'sent',
    };
  } catch (_error) {
    // Messages that cannot be decrypted are hidden instead of breaking the list.
    return null;
  }
}

function useDecryptedMessages({
  messages,
  receiverPublicKey,
  isKeyLoading,
  myId,
}: {
  messages: MessagesData;
  receiverPublicKey: string | undefined;
  isKeyLoading: boolean;
  myId: string;
}) {
  const [decrypted, setDecrypted] = useState<DecryptedMessage[]>([]);

  useEffect(() => {
    if (isKeyLoading) return;
    let cancelled = false;

    async function run() {
      try {
        const sessionPrivateKey = getSessionPrivateKey();
        const myPublicKeyRaw = await KeyStorage.loadPublicKeyRaw();
        const receiverKeyRaw = receiverPublicKey
          ? await KeyManager.fromBase64(receiverPublicKey)
          : null;

        if (!myPublicKeyRaw || !receiverKeyRaw) {
          if (!cancelled) setDecrypted([]);
          return;
        }

        const out = await Promise.all(
          (messages ?? []).map((message) =>
            decryptOne(message, receiverKeyRaw, sessionPrivateKey, myId),
          ),
        );

        if (!cancelled) {
          setDecrypted(out.filter((x): x is DecryptedMessage => x !== null));
        }
      } catch (_error) {
        // Without usable keys nothing can be shown, so fall back to an empty list.
        if (!cancelled) setDecrypted([]);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [isKeyLoading, messages, myId, receiverPublicKey]);

  return decrypted;
}

function useOutbox(decrypted: DecryptedMessage[]) {
  const qc = useQueryClient();
  const { sendMessage } = useChatSocketActions();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);

  useEffect(() => {
    const confirmedIds = getConfirmedIds(decrypted);
    if (confirmedIds.size === 0) return;

    setPending((current) => {
      const next = current.filter((item) => !confirmedIds.has(item.id));
      return next.length === current.length ? current : next;
    });
  }, [decrypted]);

  function setStatus(id: string, status: PendingMessage['status']) {
    setPending((current) =>
      current.map((candidate) =>
        candidate.id === id ? { ...candidate, status } : candidate,
      ),
    );
  }

  async function deliver(item: PendingMessage) {
    setComposerError(null);
    setStatus(item.id, 'sending');

    try {
      await sendMessage(item.payload);
      setStatus(item.id, 'sent');
      void qc.invalidateQueries({ queryKey: chatKeys.messagesRoot() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FAILED_TO_SEND';
      setComposerError(message);
      setStatus(item.id, 'failed');
    }
  }

  function enqueue(item: PendingMessage) {
    setPending((current) => [...current, item]);
    void deliver(item);
  }

  function retry(id: string) {
    const item = pending.find((candidate) => candidate.id === id);
    if (item) void deliver(item);
  }

  const confirmedIds = getConfirmedIds(decrypted);
  const visiblePending = pending.filter((item) => !confirmedIds.has(item.id));

  return {
    visiblePending,
    composerError,
    setComposerError,
    enqueue,
    retry,
  };
}

function ChatNotices({
  composerError,
  isConnected,
}: {
  composerError: string | null;
  isConnected: boolean;
}) {
  return (
    <>
      {composerError && (
        <output className='block px-4 py-2 text-xs text-red-400'>
          Message not sent: {composerError}. Retry from the message bubble.
        </output>
      )}
      {!isConnected && (
        <output className='sr-only'>
          Reconnecting. Message sending is temporarily unavailable.
        </output>
      )}
    </>
  );
}

export function ChatPage({
  conversationId,
  receiverId,
  receiverName,
  myId,
  isConnected,
}: ChatPageProps) {
  const { typingStart, typingStop } = useChatSocketActions();
  const {
    data: messages,
    isLoading: messagesIsLoading,
    isError,
  } = useMessages(conversationId);
  useChatRealtimeMessages();

  const { data: receiverKey, isLoading } = useUserPublicKey(receiverId);
  const [input, setInput] = useState('');
  const decrypted = useDecryptedMessages({
    messages,
    receiverPublicKey: receiverKey?.publicKey,
    isKeyLoading: isLoading,
    myId,
  });
  const { visiblePending, composerError, setComposerError, enqueue, retry } =
    useOutbox(decrypted);

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

      setInput('');
      enqueue({
        id: clientMessageId,
        text,
        time: formatTime(new Date()),
        status: 'sending',
        payload: { clientMessageId, conversationId, ...ciphertext },
      });
    } catch (_error) {
      setComposerError('ENCRYPTION_FAILED');
    }
  }

  function handleTyping(value: string) {
    setInput(value);
    if (value.trim()) typingStart(conversationId);
    else typingStop(conversationId);
  }

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
      <ChatHeader title={receiverName} isConnected={isConnected} />
      <MessageList
        isLoading={messagesIsLoading}
        isError={isError}
        loadingMessage='decrypting messages...'
        messages={visibleMessages}
        peerName={receiverName}
        onRetryMessage={retry}
      />
      <ChatNotices composerError={composerError} isConnected={isConnected} />
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
