import * as React from 'react';

export interface SidebarItemProps {
  id: string;
  username: string;
  isActive?: boolean;
  onClick: () => void;
}

export function SidebarItem({
  username,
  isActive = false,
  onClick,
}: SidebarItemProps) {
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <button
      onClick={onClick}
      className={[
        'flex w-full items-center gap-3 px-4 py-3 text-left',
        'transition-colors duration-100',
        isActive
          ? 'bg-[var(--cipher-surface-2)] border-l-2 border-l-[var(--cipher-accent)]'
          : 'border-l-2 border-l-transparent hover:bg-[var(--cipher-surface-2)]',
      ].join(' ')}
    >
      <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[var(--cipher-border)] bg-[var(--cipher-surface)]'>
        <span className='font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]'>
          {initials}
        </span>
      </div>
      <span className='truncate font-[var(--cipher-font-sans)] text-[13px] text-[var(--cipher-text)]'>
        {username}
      </span>
    </button>
  );
}
