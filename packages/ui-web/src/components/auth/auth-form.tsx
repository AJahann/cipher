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
  formError: string | null;
  isPending: boolean;
}

interface FieldErrors {
  username?: string;
  password?: string;
  confirm?: string;
}

const INITIAL: FormState = {
  username: '',
  password: '',
  confirm: '',
  formError: null,
  isPending: false,
};

export function AuthForm({ onLogin, onRegister }: AuthFormProps) {
  const [mode, setMode] = React.useState<AuthMode>('login');
  const [state, setState] = React.useState<FormState>(INITIAL);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const confirmRef = React.useRef<HTMLInputElement>(null);
  const errorSummaryRef = React.useRef<HTMLDivElement>(null);
  const pendingRef = React.useRef(false);

  function update(patch: Partial<FormState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  function switchMode(next: AuthMode) {
    if (pendingRef.current) return;
    setMode(next);
    setState(INITIAL);
    setFieldErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pendingRef.current) return;

    const nextErrors: FieldErrors = {};
    if (!state.username.trim()) nextErrors.username = 'username is required';
    if (!state.password) nextErrors.password = 'passphrase is required';
    if (mode === 'register') {
      if (!state.confirm) {
        nextErrors.confirm = 'confirm your passphrase';
      } else if (state.password !== state.confirm) {
        nextErrors.confirm = 'passphrases do not match';
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      update({ formError: null });
      requestAnimationFrame(() => {
        if (nextErrors.username) usernameRef.current?.focus();
        else if (nextErrors.password) passwordRef.current?.focus();
        else confirmRef.current?.focus();
      });
      return;
    }

    pendingRef.current = true;
    setFieldErrors({});
    update({ formError: null, isPending: true });

    try {
      if (mode === 'register') {
        await onRegister(state.username, state.password);
      } else {
        await onLogin(state.username, state.password);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'authentication failed';
      update({ formError: msg });
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
    } finally {
      pendingRef.current = false;
      update({ isPending: false });
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
        <div
          role='group'
          aria-label='Authentication mode'
          className='mb-8 flex overflow-hidden rounded-lg border border-(--cipher-border)'
        >
          {(['login', 'register'] as AuthMode[]).map((m) => (
            <button
              key={m}
              type='button'
              aria-pressed={mode === m}
              disabled={state.isPending}
              onClick={() => switchMode(m)}
              className={[
                'flex-1 py-2 font-(--cipher-font-mono) text-[12px] tracking-[0.06em] transition-colors duration-150',
                'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--cipher-accent)',
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
        <form
          noValidate
          aria-busy={state.isPending}
          onSubmit={handleSubmit}
          className='flex flex-col gap-4'
        >
          <Input
            ref={usernameRef}
            label='username'
            type='text'
            placeholder='your handle'
            value={state.username}
            onChange={(e) => {
              update({ username: e.target.value });
              setFieldErrors((errors) => ({ ...errors, username: undefined }));
            }}
            autoComplete='username'
            error={fieldErrors.username}
            required
          />
          <Input
            ref={passwordRef}
            label='passphrase'
            type='password'
            placeholder='used to wrap your private key'
            value={state.password}
            onChange={(e) => {
              update({ password: e.target.value });
              setFieldErrors((errors) => ({ ...errors, password: undefined }));
            }}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            error={fieldErrors.password}
            required
          />
          {isRegister && (
            <Input
              ref={confirmRef}
              label='confirm passphrase'
              type='password'
              placeholder='repeat passphrase'
              value={state.confirm}
              onChange={(e) => {
                update({ confirm: e.target.value });
                setFieldErrors((errors) => ({ ...errors, confirm: undefined }));
              }}
              autoComplete='new-password'
              error={fieldErrors.confirm}
              required
            />
          )}

          {state.formError && (
            <div
              ref={errorSummaryRef}
              role='alert'
              tabIndex={-1}
              className='rounded-(--cipher-radius-md) border border-(--cipher-danger) p-3 font-(--cipher-font-mono) text-[11px] text-(--cipher-danger) outline-none focus-visible:ring-2 focus-visible:ring-(--cipher-danger)'
            >
              Authentication failed: {state.formError}
            </div>
          )}

          {state.isPending && (
            <p role='status' className='sr-only'>
              {isRegister ? 'Creating account' : 'Signing in'}
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
