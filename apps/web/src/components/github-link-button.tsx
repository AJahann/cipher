'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/data-layer/client';

export function GitHubLinkButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setPending(true);
    setError(null);
    try {
      const { authorizeUrl } = await apiFetch<{ authorizeUrl: string }>(
        '/auth/github/link',
        { method: 'POST' },
      );
      // Full navigation is intentional: no OAuth token or verifier enters JS.
      window.location.assign(authorizeUrl);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to link GitHub',
      );
      setPending(false);
    }
  }

  return (
    <div className='border-t border-(--cipher-border) p-3 text-sm text-(--cipher-text)'>
      <button
        type='button'
        disabled={pending}
        onClick={link}
        className='rounded px-2 py-1 underline focus-visible:ring-2 focus-visible:ring-(--cipher-accent)'
      >
        {pending
          ? 'Connecting to GitHub…'
          : 'Link GitHub to this Cipher account'}
      </button>
      {error && <p role='alert'>{error}</p>}
    </div>
  );
}
