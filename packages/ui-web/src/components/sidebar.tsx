import * as React from 'react';
import { SidebarItem } from './sidebar-item';

export interface SidebarUser {
  id: string;
  username: string;
}

export interface SidebarProps {
  users: SidebarUser[];
  activeUserId?: string | null;
  onSelect: (userId: string) => void;
}

export function Sidebar({ users, activeUserId, onSelect }: SidebarProps) {
  return (
    <aside className='flex w-60 flex-shrink-0 flex-col border-r border-[var(--cipher-border)] bg-[var(--cipher-surface)]'>
      {/* top bar */}
      <div className='flex items-center gap-2 border-b border-[var(--cipher-border)] px-4 py-3.5'>
        <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--cipher-accent)]' />
        <span className='font-[var(--cipher-font-mono)] text-[12px] tracking-[0.08em] text-[var(--cipher-accent)]'>
          cipher
        </span>
      </div>

      <div className='px-4 py-3'>
        <p className='font-[var(--cipher-font-mono)] text-[10px] uppercase tracking-[0.1em] text-[var(--cipher-muted)]'>
          conversations
        </p>
      </div>

      <div className='flex-1 overflow-y-auto scrollbar-track-transparent scrollbar-thumb-accent-dim'>
        {users.length === 0 ? (
          <p className='px-4 py-2 font-[var(--cipher-font-mono)] text-[11px] text-[var(--cipher-muted)]'>
            no users found
          </p>
        ) : (
          users.map((u) => (
            <SidebarItem
              key={u.id}
              id={u.id}
              username={u.username}
              isActive={u.id === activeUserId}
              onClick={() => onSelect(u.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
