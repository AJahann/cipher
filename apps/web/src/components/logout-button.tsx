'use client';
import { useState } from 'react';
import { useLogout } from '@/lib/data-layer/user';
export function LogoutButton() {
  const logout = useLogout();
  const [error, setError] = useState<string | null>(null);
  async function signOut() {
    setError(null);
    try {
      await logout.mutateAsync();
      window.location.replace('/');
    } catch {
      setError(
        'Sign out failed. Your server session may still be active; try again.',
      );
    }
  }
  return (
    <div className='p-3 text-sm'>
      <button
        type='button'
        disabled={logout.isPending}
        onClick={signOut}
        className='underline'
      >
        {logout.isPending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && <p role='alert'>{error}</p>}
    </div>
  );
}
