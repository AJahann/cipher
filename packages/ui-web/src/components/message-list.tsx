'use client';

import * as React from 'react';
import { MessageBubble, type DecryptedMessage } from './message-bubble';

export interface MessageListProps {
  messages: DecryptedMessage[];
  loadingMessage: string;
  isLoading: boolean;
  isError?: boolean;
  peerName?: string;
  onRetryMessage?: (id: string) => void;
}

export function MessageList({
  messages,
  loadingMessage,
  isLoading,
  isError = false,
  peerName,
  onRetryMessage,
}: MessageListProps) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <output className='block font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)'>
          {isLoading
            ? loadingMessage
            : isError
              ? '// messages could not be loaded · refresh to retry'
              : '// no messages yet · send the first one'}
        </output>
      </div>
    );
  }

  return (
    <div
      role='log'
      aria-label='Messages'
      aria-live='polite'
      aria-relevant='additions text'
      className='flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4'
    >
      {isError && (
        <output className='block text-center text-[11px] text-red-400'>
          Could not refresh messages. Showing cached messages.
        </output>
      )}
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          peerName={peerName}
          onRetry={
            msg.deliveryStatus === 'failed'
              ? () => onRetryMessage?.(msg.id)
              : undefined
          }
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
