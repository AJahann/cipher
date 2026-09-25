'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Loading from '../loading';
import { useMe } from '@/lib/data-layer/user';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/');
    }
  }, [user, isLoading, router]);

  if (isLoading) return <Loading />;

  return children;
}
