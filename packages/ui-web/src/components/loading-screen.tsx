import * as React from 'react';

export interface LoadingScreenProps {
  message?: string;
}

// Rendered while AuthGuard resolves the session and while SessionGate is
// "checking"; it is also the prerendered HTML for /chat, so it must stand on
// its own as a page: a main landmark with a heading.
export function LoadingScreen({ message = 'loading...' }: LoadingScreenProps) {
  return (
    <main className='flex flex-1 items-center justify-center'>
      <h1 className='font-(--cipher-font-mono) text-[11px] font-normal text-(--cipher-muted)'>
        {message}
      </h1>
    </main>
  );
}
