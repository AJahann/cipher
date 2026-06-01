'use client';

import * as React from 'react';
import { MessageBubble } from './message-bubble';
import type { DecryptedMessage } from './message-bubble';

export interface MessageListProps {
  messages: DecryptedMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <p className='font-[var(--cipher-font-mono)] text-[11px] text-[var(--cipher-muted)]'>
          // no messages yet · send the first one
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
