'use client';

import { useEffect, useState } from 'react';
import {
  hasSessionPrivateKey,
  restoreSessionKeys,
  STORAGE_KEY,
} from '@chat-app/shared/crypto';
import { useRouter } from 'next/navigation';

type State = 'checking' | 'need-login' | 'need-unlock' | 'ready';

export function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const wrapped = localStorage.getItem(STORAGE_KEY);

    if (!wrapped) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState('need-login');
      return;
    }

    if (hasSessionPrivateKey()) {
      setState('ready');
      return;
    }

    setState('need-unlock');
  }, []);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await restoreSessionKeys(password);
      setState('ready');
    } catch {
      setError('Wrong password or damaged key');
    } finally {
      setLoading(false);
    }
  }

  if (state === 'checking') {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        Loading...
      </div>
    );
  }

  if (state === 'need-login') {
    router.replace('/');
    return null;
  }

  if (state === 'need-unlock') {
    return (
      <div className='flex min-h-screen items-center justify-center bg-black text-white'>
        <form
          onSubmit={handleUnlock}
          className='flex w-80 flex-col gap-4 rounded-md border border-gray-800 p-6'
        >
          <p className='text-2xl font-semibold'>Unlock your session</p>

          <input
            className='border border-white rounded-sm py-2 px-4 bg-transparent text-white placeholder:text-gray-500 outline-none'
            placeholder='Password'
            type='password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete='current-password'
            required
          />

          {error && <p className='text-sm text-red-400'>{error}</p>}

          <button
            type='submit'
            disabled={loading}
            className='bg-gray-800 hover:bg-gray-700 disabled:opacity-50 h-12 rounded-sm transition-colors'
          >
            {loading ? 'UNLOCKING...' : 'UNLOCK'}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
