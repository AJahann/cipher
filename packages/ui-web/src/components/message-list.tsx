'use client';

import * as React from 'react';
import { MessageBubble, type DecryptedMessage } from './message-bubble';

export interface MessageListProps {
  messages: DecryptedMessage[];
  loadingMessage: string;
  isLoading: boolean;
  isError?: boolean;
  onRetryMessage?: (id: string) => void;
}

export function MessageList({
  messages,
  loadingMessage,
  isLoading,
  isError = false,
  onRetryMessage,
}: MessageListProps) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <p
          role={isError ? 'alert' : undefined}
          className='font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)'
        >
          {isLoading
            ? loadingMessage
            : isError
              ? '// messages could not be loaded · refresh to retry'
              : '// no messages yet · send the first one'}
        </p>
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4'>
      {isError && (
        <p role='alert' className='text-center text-[11px] text-red-400'>
          Could not refresh messages. Showing cached messages.
        </p>
      )}
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
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
