import * as React from 'react';

export interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'loading...' }: LoadingScreenProps) {
  return (
    <div className='flex flex-1 items-center justify-center'>
      <p className='font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)'>
        {message}
      </p>
    </div>
  );
}
