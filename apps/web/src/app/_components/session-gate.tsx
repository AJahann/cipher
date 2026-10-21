'use client';

import { useEffect, useState } from 'react';
import {
  clearSessionKeys,
  hasSessionPrivateKey,
  restoreSessionKeys,
  STORAGE_KEY,
} from '@chat-app/shared/crypto';
import { useRouter } from 'next/navigation';
import { LoadingScreen, UnlockForm } from '@chat-app/ui-web';
import { apiFetch } from '../../lib/data-layer/client';
import { KeyStorage } from '../../lib/keyStorage';

interface WrappedPrivateKey {
  ciphertext: string;
  salt: string;
  nonce: string;
}

type State = 'checking' | 'need-unlock' | 'ready' | 'error';

export function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // OAuth authenticates a user, not their encryption key. Load only that
    // session user's encrypted bundle, including on a new browser. Never trust
    // a previous user's localStorage bundle after switching accounts.
    apiFetch<{ publicKey: string; wrappedPrivateKey: WrappedPrivateKey }>(
      '/auth/key-bundle',
    )
      .then((bundle) => {
        if (!active) return;
        const alreadyUnlocked =
          KeyStorage.loadPublicKey() === bundle.publicKey &&
          hasSessionPrivateKey();
        if (!alreadyUnlocked) clearSessionKeys();
        KeyStorage.savePublicKey(bundle.publicKey);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(bundle.wrappedPrivateKey),
        );
        setState(alreadyUnlocked ? 'ready' : 'need-unlock');
      })
      .catch((cause) => {
        if (!active) return;
        clearSessionKeys();
        KeyStorage.clear();
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load encryption keys',
        );
        setState('error');
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleUnlock(password: string) {
    await restoreSessionKeys(password);
    setState('ready');
  }

  if (state === 'checking') return <LoadingScreen />;

  if (state === 'error') {
    return (
      <div role='alert'>
        Unable to unlock this account: {error}.{' '}
        <button type='button' onClick={() => router.replace('/')}>
          Return to sign in
        </button>
      </div>
    );
  }

  if (state === 'need-unlock') {
    return <UnlockForm onUnlock={handleUnlock} />;
  }

  return children;
}
