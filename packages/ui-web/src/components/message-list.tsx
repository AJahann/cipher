'use client';

import * as React from 'react';
import { MessageBubble, type DecryptedMessage } from './message-bubble';

export interface MessageListProps {
  messages: DecryptedMessage[];
  loadingMessage: string;
  isLoading: boolean;
}

export function MessageList({
  messages,
  loadingMessage,
  isLoading,
}: MessageListProps) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <p className='font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)'>
          {isLoading
            ? loadingMessage
            : '// no messages yet · send the first one'}
        </p>
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4'>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
