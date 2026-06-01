'use client';

import * as React from 'react';
import { Badge } from '../primitives/badge';
import { Input } from '../primitives/input';
import { Button } from '../primitives/button';

export type AuthMode = 'login' | 'register';

export interface AuthFormProps {
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
}

interface FormState {
  username: string;
  password: string;
  confirm: string;
  error: string | null;
  isPending: boolean;
}

const INITIAL: FormState = {
  username: '',
  password: '',
  confirm: '',
  error: null,
  isPending: false,
};

export function AuthForm({ onLogin, onRegister }: AuthFormProps) {
  const [mode, setMode] = React.useState<AuthMode>('login');
  const [state, setState] = React.useState<FormState>(INITIAL);

  function update(patch: Partial<FormState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setState(INITIAL);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    update({ error: null, isPending: true });

    try {
      if (mode === 'register') {
        if (state.password !== state.confirm) {
          update({ error: 'passphrases do not match', isPending: false });
          return;
        }
        await onRegister(state.username, state.password);
      } else {
        await onLogin(state.username, state.password);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'authentication failed';
      update({ error: msg, isPending: false });
    }
  }

  const isRegister = mode === 'register';

  return (
    <div className='flex min-h-screen items-center justify-center bg-(--cipher-bg) px-4'>
      <div className='w-full max-w-sm'>
        {/* logo + badge */}
        <div className='mb-10 flex flex-col gap-3'>
          <div className='flex items-center gap-2.5'>
            <span className='h-2 w-2 animate-pulse rounded-full bg-(--cipher-accent)' />
            <span className='font-(--cipher-font-mono) text-[13px] tracking-[0.08em] text-(--cipher-accent)'>
              cipher
            </span>
          </div>
          <Badge variant='encrypted'>end-to-end encrypted</Badge>
        </div>

        {/* tab switcher */}
        <div className='mb-8 flex overflow-hidden rounded-lg border border-(--cipher-border)'>
          {(['login', 'register'] as AuthMode[]).map((m) => (
            <button
              key={m}
              type='button'
              onClick={() => switchMode(m)}
              className={[
                'flex-1 py-2 font-(--cipher-font-mono) text-[12px] tracking-[0.06em] transition-colors duration-150',
                mode === m
                  ? 'bg-(--cipher-surface-2) text-(--cipher-text)'
                  : 'bg-transparent text-(--cipher-muted) hover:text-(--cipher-text)',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>

        {/* heading */}
        <div className='mb-7'>
          <h1 className='font-(--cipher-font-sans) text-[22px] tracking-tight text-(--cipher-text)'>
            {isRegister ? 'Create account' : 'Welcome back'}
          </h1>
          <p className='mt-1 font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)'>
            {isRegister
              ? '// keys generated locally in your browser'
              : '// session keys derived from your passphrase'}
          </p>
        </div>

        {/* form */}
        <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
          <Input
            label='username'
            type='text'
            placeholder='your handle'
            value={state.username}
            onChange={(e) => update({ username: e.target.value })}
            autoComplete='username'
            required
          />
          <Input
            label='passphrase'
            type='password'
            placeholder='used to wrap your private key'
            value={state.password}
            onChange={(e) => update({ password: e.target.value })}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
          />
          {isRegister && (
            <Input
              label='confirm passphrase'
              type='password'
              placeholder='repeat passphrase'
              value={state.confirm}
              onChange={(e) => update({ confirm: e.target.value })}
              autoComplete='new-password'
              required
            />
          )}

          {state.error && (
            <p className='font-(--cipher-font-mono) text-[11px] text-(--cipher-danger)'>
              {state.error}
            </p>
          )}

          <Button
            type='submit'
            isLoading={state.isPending}
            loadingText={
              isRegister ? 'generating keys...' : 'authenticating...'
            }
            className='mt-1'
          >
            {isRegister ? 'generate keys + register' : 'authenticate'}
          </Button>
        </form>
      </div>
    </div>
  );
}
