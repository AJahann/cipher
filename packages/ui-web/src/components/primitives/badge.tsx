import * as React from 'react';

export type BadgeVariant =
  | 'encrypted'
  | 'connected'
  | 'disconnected'
  | 'default';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  encrypted:
    'text-[var(--cipher-success)] border-[var(--cipher-success-border)]',
  connected:
    'text-[var(--cipher-success)] border-[var(--cipher-success-border)]',
  disconnected:
    'text-[var(--cipher-danger)] border-[var(--cipher-dangerMuted)]',
  default: 'text-[var(--cipher-muted)] border-[var(--cipher-border)]',
};

const dotClasses: Record<BadgeVariant, string> = {
  encrypted: 'bg-[var(--cipher-success)]',
  connected: 'bg-[var(--cipher-success)]',
  disconnected: 'bg-[var(--cipher-danger)]',
  default: 'bg-[var(--cipher-muted)]',
};

export function Badge({
  variant = 'default',
  children,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5',
        'rounded border px-1.5 py-0.5',
        'font-(--cipher-font-mono) text-[10px] tracking-[0.06em]',
        variantClasses[variant],
        className,
      ].join(' ')}
    >
      <span
        className={['h-1.5 w-1.5 rounded-full', dotClasses[variant]].join(' ')}
      />
      {children}
    </span>
  );
}
