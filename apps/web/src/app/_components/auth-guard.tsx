'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Loading from '../loading';
import { useMe } from '@/lib/data-layer/user';
import { useQueryClient } from '@tanstack/react-query';
import { clearClientSession } from '@/lib/client-session';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useMe();
  const router = useRouter();
  const client = useQueryClient();

  useEffect(() => {
    if (!isLoading && !user) {
      void clearClientSession(client, false).then(() => router.replace('/'));
    }
  }, [user, isLoading, router, client]);

  if (isLoading || !user) return <Loading />;

  return children;
}
