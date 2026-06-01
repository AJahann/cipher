import * as React from 'react';

export interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'loading...' }: LoadingScreenProps) {
  return (
    <div className='flex min-h-screen items-center justify-center bg-[var(--cipher-bg)]'>
      <p className='font-[var(--cipher-font-mono)] text-[13px] text-[var(--cipher-muted)]'>
        {message}
      </p>
    </div>
  );
}
