import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

export function makeClient(queryOptions: Record<string, unknown> = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, ...queryOptions },
    },
  });
}

export function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
