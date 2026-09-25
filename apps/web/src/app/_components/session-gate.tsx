'use client';

import { useEffect, useState } from 'react';
import {
  hasSessionPrivateKey,
  restoreSessionKeys,
  STORAGE_KEY,
} from '@chat-app/shared/crypto';
import { useRouter } from 'next/navigation';
import { LoadingScreen, UnlockForm } from '@chat-app/ui-web';

type State = 'checking' | 'need-login' | 'need-unlock' | 'ready';

export function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    const wrapped = localStorage.getItem(STORAGE_KEY);
    if (!wrapped) {
      // oxlint-disable-next-line react/set-state-in-effect
      setState('need-login');
      return;
    }
    if (hasSessionPrivateKey()) {
      setState('ready');
      return;
    }
    setState('need-unlock');
  }, []);

  async function handleUnlock(password: string) {
    await restoreSessionKeys(password);
    setState('ready');
  }

  if (state === 'checking') return <LoadingScreen />;

  if (state === 'need-login') {
    router.replace('/');
    return null;
  }

  if (state === 'need-unlock') {
    return <UnlockForm onUnlock={handleUnlock} />;
  }

  return <>{children}</>;
}
