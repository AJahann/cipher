import * as React from 'react';
import { Badge } from './primitives/badge';

export interface ChatHeaderProps {
  title?: string;
  isConnected: boolean;
}

export function ChatHeader({ title = 'Chat', isConnected }: ChatHeaderProps) {
  return (
    <header className='flex items-center gap-3 border-b border-[var(--cipher-border)] bg-[var(--cipher-surface)] px-5 py-3.5'>
      <p className='font-[var(--cipher-font-sans)] text-[13px] font-medium text-[var(--cipher-text)]'>
        {title}
      </p>
      <Badge variant={isConnected ? 'connected' : 'disconnected'}>
        {isConnected ? 'connected' : 'disconnected'}
      </Badge>
    </header>
  );
}
