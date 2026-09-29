'use client';

import * as React from 'react';

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = 'Write a message...',
}: ChatInputProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && value.trim() && !disabled) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className='flex items-end gap-2 border-t border-[var(--cipher-border)] bg-[var(--cipher-surface)] p-3'>
      <label htmlFor='message-composer' className='sr-only'>
        Message
      </label>
      <textarea
        id='message-composer'
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={[
          'flex-1 resize-none rounded-xl border border-[var(--cipher-border)]',
          'bg-[var(--cipher-surface-2)] px-3.5 py-2.5',
          'font-[var(--cipher-font-sans)] text-[13px] text-[var(--cipher-text)]',
          'placeholder:text-[var(--cipher-muted)] outline-none',
          'transition-colors focus:border-[var(--cipher-accent-dim)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--cipher-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cipher-bg)]',
          'max-h-32 overflow-y-auto disabled:cursor-not-allowed disabled:opacity-60',
        ].join(' ')}
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        aria-label='Send message'
        className={[
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
          'bg-[var(--cipher-accent)] text-white transition-all duration-150',
          'outline-none focus-visible:ring-2 focus-visible:ring-[var(--cipher-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cipher-bg)]',
          'hover:bg-[var(--cipher-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed',
        ].join(' ')}
      >
        <svg width='14' height='14' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
          <path d='M12.5 7L1.5 1.5L4 7L1.5 12.5L12.5 7Z' fill='currentColor' />
        </svg>
      </button>
    </div>
  );
}
