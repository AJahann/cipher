'use client';

import { useEffect, useRef, useState } from 'react';
import { useMessages } from '@/lib/data-layer/chats';
import { useUserPublicKey } from '@/lib/data-layer/user';
import {
  useChatSocketActions,
  useChatRealtimeMessages,
} from '@/lib/data-layer/chats/use-chat-socket';

import { E2EEncryption, getSessionPrivateKey } from '@chat-app/shared/crypto';
import { KeyStorage } from '@/lib/keyStorage';
import { KeyManager } from '@chat-app/shared';

interface DecryptedMessage {
  id: string;
  senderId: string;
  text: string;
  time: string;
  isMine: boolean;
}

function Bubble({ msg }: { msg: DecryptedMessage }) {
  const { isMine, senderId, text, time } = msg;
  return (
    <div className={`flex items-end gap-1.5 ${isMine ? 'justify-end' : ''}`}>
      {!isMine && (
        <div className='w-6 h-6 rounded-full bg-blue-100 text-blue-800 text-[9px] flex items-center justify-center'>
          {senderId.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div
        className={`max-w-[65%] px-3 py-2 text-[13px] ${
          isMine
            ? 'bg-blue-500 text-white rounded-2xl rounded-br-sm'
            : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white rounded-2xl rounded-bl-sm border'
        }`}
      >
        {text}
        <p
          className={`text-[10px] mt-1 text-right ${isMine ? 'text-blue-100' : 'text-gray-400'}`}
        >
          {time}
        </p>
      </div>
    </div>
  );
}

function formatTime(ts?: string | number | Date) {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [decrypted]);

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
              const senderPublicKey = receiverKeyRaw;

              const plain = await E2EEncryption.decryptMessage(
                m.ciphertext,
                m.nonce,
                senderPublicKey,
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
    if (!input.trim()) return;
    if (!receiverKey?.publicKey) return;

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

  return (
    <main className='flex-1 flex flex-col min-w-0 text-white'>
      <header className='px-4 py-3 border-b border-b-white text-white flex items-center gap-2'>
        <p className='font-medium text-sm'>Chat</p>
        <span
          className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-green-400' : 'bg-red-400'
          }`}
        />
      </header>

      <div className='flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2'>
        {decrypted.map((msg) => (
          <Bubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className='flex items-center gap-2 p-3 border-t'>
        <textarea
          rows={1}
          placeholder='Write a message...'
          className='flex-1 bg-gray-100 dark:bg-neutral-800 rounded-2xl px-3 py-2 text-sm outline-none resize-none text-black dark:text-white'
          value={input}
          onChange={(e) => handleTyping(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className='w-8 h-8 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white rounded-full flex items-center justify-center'
        >
          →
        </button>
      </div>
    </main>
  );
}
