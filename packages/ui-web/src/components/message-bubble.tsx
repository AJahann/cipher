import * as React from 'react';

export interface DecryptedMessage {
  id: string;
  clientMessageId?: string;
  senderId: string;
  text: string;
  time: string;
  isMine: boolean;
  deliveryStatus?: 'sending' | 'sent' | 'failed';
}

export interface MessageBubbleProps {
  msg: DecryptedMessage;
  onRetry?: () => void;
}

export function MessageBubble({ msg, onRetry }: MessageBubbleProps) {
  const { isMine, senderId, text, time, deliveryStatus } = msg;

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
          deliveryStatus === 'failed' ? 'ring-1 ring-red-400' : '',
          deliveryStatus === 'sending' ? 'opacity-70' : '',
        ].join(' ')}
      >
        <p className='font-[var(--cipher-font-sans)] text-[13px] leading-relaxed'>
          {text}
        </p>
        <div className='mt-1 flex items-center justify-end gap-2'>
          {isMine && deliveryStatus && (
            <span className='font-[var(--cipher-font-mono)] text-[9px] text-white/60'>
              {deliveryStatus}
            </span>
          )}
          <span className='font-[var(--cipher-font-mono)] text-[10px] text-white/60'>
            {time}
          </span>
          {deliveryStatus === 'failed' && onRetry && (
            <button
              type='button'
              onClick={onRetry}
              aria-label={`Retry sending message: ${text}`}
              className='rounded font-[var(--cipher-font-mono)] text-[10px] underline outline-none focus-visible:ring-2 focus-visible:ring-white'
            >
              retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
