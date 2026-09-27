import * as React from 'react';

export interface AppShellProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className='flex h-screen bg-(--cipher-bg) font-(--cipher-font-sans)'>
      {sidebar}
      {children}
    </div>
  );
}

export function EmptyState() {
  return (
    <main className='flex flex-1 items-center justify-center'>
      <p className='font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)'>
        &#x2F;&#x2F; select a conversation to begin
      </p>
    </main>
  );
}
