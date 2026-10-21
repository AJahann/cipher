'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  chatKeys,
  type useMessages,
  useMessageHistory,
} from '@/lib/data-layer/chats';
import { useUserPublicKey } from '@/lib/data-layer/user';
import type { SendMessageInput } from '@chat-app/shared/contracts';
import {
  useChatSocketActions,
  useChatRealtimeMessages,
} from '@/lib/data-layer/chats/use-chat-socket';
import {
  encryptChatMessage,
  decryptChatMessage,
  getSessionPrivateKey,
} from '@chat-app/shared/crypto';
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
  payload: SendMessageInput;
}

interface ChatPageProps {
  conversationId: string;
  receiverId: string;
  receiverName: string;
  myId: string;
  isConnected: boolean;
  onUnsentChange?: (value: boolean) => void;
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
  {
    myId,
    receiverId,
    conversationId,
  }: { myId: string; receiverId: string; conversationId: string },
): Promise<DecryptedMessage> {
  try {
    if (![myId, receiverId].includes(message.senderId))
      throw new Error('UNEXPECTED_SENDER');
    const plain = await decryptChatMessage(
      message,
      receiverKeyRaw,
      sessionPrivateKey,
      {
        senderId: message.senderId,
        recipientId: message.senderId === myId ? receiverId : myId,
        conversationId,
        clientMessageId: message.clientMessageId,
      },
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
    return {
      id: message.id,
      senderId: message.senderId,
      text: 'Unable to decrypt or verify this message. Its key, format, or authenticated context may not match.',
      time: formatTime(message.createdAt),
      isMine: message.senderId === myId,
      decryptionFailed: true,
    };
  }
}

function useDecryptedMessages({
  messages,
  receiverPublicKey,
  isKeyLoading,
  myId,
  receiverId,
  conversationId,
}: {
  messages: MessagesData;
  receiverPublicKey: string | undefined;
  isKeyLoading: boolean;
  myId: string;
  receiverId: string;
  conversationId: string;
}) {
  const [decrypted, setDecrypted] = useState<DecryptedMessage[]>([]);
  const [keyError, setKeyError] = useState<string | null>(null);

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
          if (!cancelled) {
            setDecrypted([]);
            setKeyError(
              'The contact encryption key is unavailable. Messages cannot be verified.',
            );
          }
          return;
        }

        const out = await Promise.all(
          (messages ?? []).map((message) =>
            decryptOne(message, receiverKeyRaw, sessionPrivateKey, {
              myId,
              receiverId,
              conversationId,
            }),
          ),
        );

        if (!cancelled) {
          setDecrypted(out);
          setKeyError(null);
        }
      } catch (_error) {
        if (!cancelled) {
          setDecrypted([]);
          setKeyError(
            'Encryption keys could not be loaded. Unlock again before sending.',
          );
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [
    isKeyLoading,
    messages,
    myId,
    receiverPublicKey,
    receiverId,
    conversationId,
  ]);

  return { decrypted, keyError };
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
      void qc.invalidateQueries({ queryKey: chatKeys.historyRoot() });
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

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function useUnsentWarning(
  input: string,
  pendingCount: number,
  onUnsentChange?: (value: boolean) => void,
) {
  useEffect(() => {
    const unsent = Boolean(input.trim()) || pendingCount > 0;
    onUnsentChange?.(unsent);
    if (!unsent) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [input, pendingCount, onUnsentChange]);
}

export function ChatPage({
  conversationId,
  receiverId,
  receiverName,
  myId,
  isConnected,
  onUnsentChange,
}: ChatPageProps) {
  const { typingStart, typingStop } = useChatSocketActions();
  const {
    data: messages,
    isLoading: messagesIsLoading,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useMessageHistory(conversationId, myId);
  useChatRealtimeMessages();

  const { data: receiverKey, isLoading } = useUserPublicKey(receiverId);
  const [input, setInput] = useState('');
  const encrypting = useRef(false);
  const mounted = useMounted();
  const { decrypted, keyError } = useDecryptedMessages({
    messages,
    receiverPublicKey: receiverKey?.publicKey,
    isKeyLoading: isLoading,
    myId,
    receiverId,
    conversationId,
  });
  const { visiblePending, composerError, setComposerError, enqueue, retry } =
    useOutbox(decrypted);

  useUnsentWarning(input, visiblePending.length, onUnsentChange);

  async function handleSend() {
    const text = input.trim();
    if (
      !text ||
      !receiverKey?.publicKey ||
      !isConnected ||
      encrypting.current ||
      keyError
    )
      return;
    encrypting.current = true;
    try {
      const senderPrivateKeyRaw = getSessionPrivateKey();
      const receiverKeyRaw = await KeyManager.fromBase64(receiverKey.publicKey);
      const clientMessageId = crypto.randomUUID();
      const ciphertext = await encryptChatMessage(
        text,
        receiverKeyRaw,
        senderPrivateKeyRaw,
        {
          senderId: myId,
          recipientId: receiverId,
          conversationId,
          clientMessageId,
        },
      );

      if (!mounted.current) return;
      setInput((current) => (current.trim() === text ? '' : current));
      enqueue({
        id: clientMessageId,
        text,
        time: formatTime(new Date()),
        status: 'sending',
        payload: { clientMessageId, conversationId, ...ciphertext },
      });
    } catch (error) {
      if (mounted.current)
        setComposerError(
          error instanceof Error && error.message === 'MESSAGE_TOO_LARGE'
            ? 'MESSAGE_TOO_LARGE'
            : 'ENCRYPTION_FAILED',
        );
    } finally {
      encrypting.current = false;
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
      {keyError && (
        <p role='alert' className='p-3 text-sm text-red-400'>
          {keyError}
        </p>
      )}
      {hasNextPage && (
        <button
          type='button'
          disabled={isFetchingNextPage}
          onClick={() => {
            void fetchNextPage();
          }}
          className='p-2 text-sm underline'
        >
          {isFetchingNextPage
            ? 'Loading older messages…'
            : 'Load older messages'}
        </button>
      )}
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
        disabled={
          !isConnected ||
          isLoading ||
          !receiverKey?.publicKey ||
          Boolean(keyError)
        }
        placeholder={isConnected ? 'Write a message...' : 'Reconnecting...'}
      />
    </main>
  );
}
