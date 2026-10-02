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
  /** Display name of the other participant; used for the avatar and sender label. */
  peerName?: string;
  onRetry?: () => void;
}

export function MessageBubble({ msg, peerName, onRetry }: MessageBubbleProps) {
  const { isMine, senderId, text, time, deliveryStatus } = msg;
  const senderLabel = isMine ? 'You' : (peerName ?? 'Contact');

  return (
    <div
      className={['flex items-end gap-2', isMine ? 'justify-end' : ''].join(
        ' ',
      )}
    >
      {!isMine && (
        <div
          aria-hidden='true'
          className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[var(--cipher-border)] bg-[var(--cipher-surface-2)]'
        >
          <span className='font-[var(--cipher-font-mono)] text-[9px] text-[var(--cipher-muted)]'>
            {(peerName ?? senderId).slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}

      <div
        className={[
          'max-w-[65%] rounded-2xl px-3.5 py-2.5',
          isMine
            ? 'rounded-ee-sm bg-[var(--cipher-accent-strong)] text-white'
            : 'rounded-es-sm border border-[var(--cipher-border)] bg-[var(--cipher-surface-2)] text-[var(--cipher-text)]',
          deliveryStatus === 'failed' ? 'ring-1 ring-red-400' : '',
          deliveryStatus === 'sending' ? 'opacity-70' : '',
        ].join(' ')}
      >
        <span className='sr-only'>{senderLabel}: </span>
        {/* dir="auto": each message resolves its own base direction from its
            first strong character, so Persian text with embedded Latin words
            and trailing punctuation lays out RTL inside an LTR app. */}
        <p
          dir='auto'
          className='whitespace-pre-wrap font-[var(--cipher-font-sans)] text-[13px] leading-relaxed'
        >
          {text}
        </p>
        <div className='mt-1 flex items-center justify-end gap-2'>
          {isMine && deliveryStatus && (
            <span className='font-[var(--cipher-font-mono)] text-[9px] text-white/85'>
              {deliveryStatus}
            </span>
          )}
          <span
            className={[
              'font-[var(--cipher-font-mono)] text-[10px]',
              isMine ? 'text-white/85' : 'text-[var(--cipher-muted)]',
            ].join(' ')}
          >
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
