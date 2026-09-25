'use client';

import * as React from 'react';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';
import { Badge } from '../primitives/badge';

export interface UnlockFormProps {
  onUnlock: (password: string) => Promise<void>;
}

export function UnlockForm({ onUnlock }: UnlockFormProps) {
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await onUnlock(password);
    } catch {
      setError('wrong passphrase or damaged key');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className='w-full flex min-h-screen items-center justify-center bg-(--cipher-bg) px-4'>
      <div className='w-full max-w-sm'>
        <div className='mb-10 flex flex-col gap-3'>
          <div className='flex items-center gap-2.5'>
            <span className='h-2 w-2 animate-pulse rounded-full bg-(--cipher-accent)' />
            <span className='font-[var(--cipher-font-mono)] text-[13px] tracking-[0.08em] text-(--cipher-accent)'>
              cipher
            </span>
          </div>
          <Badge variant='encrypted'>end-to-end encrypted</Badge>
        </div>

        <div className='mb-7'>
          <h1 className='font-[var(--cipher-font-sans)] text-[22px] font-light tracking-tight text-[var(--cipher-text)]'>
            Unlock session
          </h1>
          <p className='mt-1 font-[var(--cipher-font-mono)] text-[11px] text-[var(--cipher-muted)]'>
            // enter passphrase to restore your private key
          </p>
        </div>

        <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
          <Input
            label='passphrase'
            type='password'
            placeholder='your session passphrase'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete='current-password'
            error={error}
            required
          />
          <Button
            type='submit'
            isLoading={isPending}
            loadingText='unlocking...'
            className='mt-1'
          >
            unlock
          </Button>
        </form>
      </div>
    </div>
  );
}
