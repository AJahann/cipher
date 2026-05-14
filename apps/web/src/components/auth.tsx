'use client';

import { useState } from 'react';
import {
  clearSessionKeys,
  createSessionKeys,
  restoreSessionKeys,
  STORAGE_KEY,
} from '@chat-app/shared/crypto';
import { useLogin, useRegister } from '@/lib/data-layer/user';
import { ApiError } from '@/lib/data-layer/client';
import { useRouter } from 'next/navigation';
import { KeyStorage } from '@/lib/keyStorage';

type Mode = 'login' | 'register';

interface AuthFormProps {
  mode: Mode;
}

function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const isRegister = mode === 'register';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const mutation = isRegister ? registerMutation : loginMutation;

  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      if (isRegister) {
        const pair = await createSessionKeys(password);

        await registerMutation.mutateAsync({
          username,
          password,
          publicKey: pair.publicKeyB64,
          wrappedPrivateKey: pair.wrappedPrivateKey,
        });

        KeyStorage.savePublicKey(pair.publicKeyB64);
      } else {
        const userLoginReq = await loginMutation.mutateAsync({
          username,
          password,
        });

        KeyStorage.savePublicKey(userLoginReq.publicKey);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(userLoginReq.wrappedPrivateKey),
        );

        await restoreSessionKeys(password);
      }

      router.push('/chat');
    } catch (err) {
      if (isRegister) {
        clearSessionKeys();
      }

      const apiErr = err as ApiError;
      setError(apiErr?.message ?? 'Failed');
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className='bg-black flex items-center justify-center flex-col gap-4 grow text-center text-white'
    >
      <p className='text-4xl'>{isRegister ? 'REGISTER' : 'LOGIN'}</p>

      <input
        className='border border-white rounded-sm py-2 px-4 bg-transparent text-white placeholder:text-gray-500 outline-none w-80'
        placeholder='Username'
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete='username'
        required
      />

      <input
        className='border border-white rounded-sm py-2 px-4 bg-transparent text-white placeholder:text-gray-500 outline-none w-80'
        placeholder='Password'
        type='password'
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={isRegister ? 'new-password' : 'current-password'}
        required
      />

      {error && <p className='text-red-400 text-sm'>{error}</p>}

      <button
        type='submit'
        disabled={mutation.isPending}
        className='bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-xl w-80 h-12 rounded-sm transition-colors'
      >
        {mutation.isPending
          ? 'PLEASE WAIT...'
          : isRegister
            ? 'REGISTER'
            : 'LOGIN'}
      </button>
    </form>
  );
}

export function Auth() {
  return (
    <div className='flex flex-col grow divide-y divide-gray-800'>
      <AuthForm mode='login' />
      <AuthForm mode='register' />
    </div>
  );
}
