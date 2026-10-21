'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import {
  clearClientSession,
  SESSION_CHANGE_EVENT,
} from '../lib/client-session';

const queryClient = new QueryClient();

interface Props {
  children: ReactNode;
}

export function QueryProvider({ children }: Props) {
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== SESSION_CHANGE_EVENT) return;
      void clearClientSession(queryClient, false).then(() =>
        window.location.replace('/'),
      );
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
