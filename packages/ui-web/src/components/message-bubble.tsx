import * as React from 'react';

export interface DecryptedMessage {
  id: string;
  senderId: string;
  text: string;
  time: string;
  isMine: boolean;
}

export interface MessageBubbleProps {
  msg: DecryptedMessage;
}

export function MessageBubble({ msg }: MessageBubbleProps) {
  const { isMine, senderId, text, time } = msg;

  return (
    <div
      className={['flex items-end gap-2', isMine ? 'justify-end' : ''].join(
        ' ',
      )}
    >
      {!isMine && (
        <div className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[var(--cipher-border)] bg-[var(--cipher-surface-2)]'>
          <span className='font-[var(--cipher-font-mono)] text-[9px] text-[var(--cipher-muted)]'>
            {senderId.slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}

      <div
        className={[
          'max-w-[65%] rounded-2xl px-3.5 py-2.5',
          isMine
            ? 'rounded-br-sm bg-[var(--cipher-accent)] text-white'
            : 'rounded-bl-sm border border-[var(--cipher-border)] bg-[var(--cipher-surface-2)] text-[var(--cipher-text)]',
        ].join(' ')}
      >
        <p className='font-[var(--cipher-font-sans)] text-[13px] leading-relaxed'>
          {text}
        </p>
        <p
          className={[
            'mt-1 text-right font-[var(--cipher-font-mono)] text-[10px]',
            isMine ? 'text-white/60' : 'text-[var(--cipher-muted)]',
          ].join(' ')}
        >
          {time}
        </p>
      </div>
    </div>
  );
}
