'use client';

import { useEffect, useState } from 'react';
import { useMessages } from '@/lib/data-layer/chats';
import { useUserPublicKey } from '@/lib/data-layer/user';
import {
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
  LoadingScreen,
} from '@chat-app/ui-web';
import type { DecryptedMessage } from '@chat-app/ui-web';

function formatTime(ts?: string | number | Date) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

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
  const { sendMessage, typingStart, typingStop } = useChatSocketActions();
  const { data: messages } = useMessages(conversationId);
  useChatRealtimeMessages();

  const { data: receiverKey, isLoading } = useUserPublicKey(receiverId);
  const [input, setInput] = useState('');
  const [decrypted, setDecrypted] = useState<DecryptedMessage[]>([]);

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
          (messages ?? []).map(async (m) => {
            try {
              const plain = await E2EEncryption.decryptMessage(
                m.ciphertext,
                m.nonce,
                receiverKeyRaw,
                sessionPrivateKey,
              );
              return {
                id: m.id,
                senderId: m.senderId,
                text: plain,
                time: formatTime(m.createdAt),
                isMine: m.senderId === myId,
              } as DecryptedMessage;
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

  async function handleSend() {
    if (!input.trim() || !receiverKey?.publicKey) return;

    const senderPrivateKeyRaw = getSessionPrivateKey();
    const receiverKeyRaw = await KeyManager.fromBase64(receiverKey.publicKey);

    const ciphertext = await E2EEncryption.encryptMessage(
      input.trim(),
      receiverKeyRaw,
      senderPrivateKeyRaw,
    );

    await sendMessage?.({
      tempId: crypto.randomUUID(),
      conversationId,
      ...ciphertext,
    });

    setInput('');
  }

  function handleTyping(value: string) {
    setInput(value);
    if (value.trim()) typingStart?.(conversationId);
    else typingStop?.(conversationId);
  }

  if (isLoading) return <LoadingScreen message='decrypting messages...' />;

  return (
    <main className='flex flex-1 min-w-0 flex-col'>
      <ChatHeader isConnected={isConnected} />
      <MessageList messages={decrypted} />
      <ChatInput value={input} onChange={handleTyping} onSend={handleSend} />
    </main>
  );
}
