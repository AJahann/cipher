import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionGate } from './session-gate';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  clearSessionKeys: vi.fn(),
  hasSessionPrivateKey: vi.fn(),
  restoreSessionKeys: vi.fn(),
  loadPublicKey: vi.fn(),
  savePublicKey: vi.fn(),
  clearStorage: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('../../lib/data-layer/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../../lib/keyStorage', () => ({
  KeyStorage: {
    loadPublicKey: mocks.loadPublicKey,
    savePublicKey: mocks.savePublicKey,
    clear: mocks.clearStorage,
  },
}));
vi.mock('@chat-app/shared/crypto', () => ({
  STORAGE_KEY: 'test-wrapped-key',
  clearSessionKeys: mocks.clearSessionKeys,
  hasSessionPrivateKey: mocks.hasSessionPrivateKey,
  restoreSessionKeys: mocks.restoreSessionKeys,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@chat-app/ui-web', () => ({
  LoadingScreen: () => <p>Checking keys</p>,
  UnlockForm: ({
    onUnlock,
  }: {
    onUnlock: (password: string) => Promise<void>;
  }) => (
    <button type='button' onClick={() => onUnlock('local-passphrase')}>
      Unlock messages
    </button>
  ),
}));

const bundle = {
  publicKey: 'current-user-key',
  wrappedPrivateKey: { ciphertext: 'encrypted', salt: 'salt', nonce: 'nonce' },
};
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.apiFetch.mockResolvedValue(bundle);
  mocks.restoreSessionKeys.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('SessionGate after GitHub login', () => {
  it('loads the current session encrypted bundle on a fresh browser and stays locked until passphrase unlock', async () => {
    mocks.hasSessionPrivateKey.mockReturnValue(false);
    render(
      <SessionGate>
        <p>Private chat</p>
      </SessionGate>,
    );
    await expect(
      screen.findByRole('button', { name: 'Unlock messages' }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByText('Private chat')).not.toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/key-bundle');
    expect(localStorage.getItem('test-wrapped-key')).toBe(
      JSON.stringify(bundle.wrappedPrivateKey),
    );
    expect(mocks.restoreSessionKeys).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock messages' }));
    await expect(
      screen.findByText('Private chat'),
    ).resolves.toBeInTheDocument();
    expect(mocks.restoreSessionKeys).toHaveBeenCalledWith('local-passphrase');
  });

  it('does not reuse a previous account private key', async () => {
    mocks.loadPublicKey.mockReturnValue('other-account-key');
    mocks.hasSessionPrivateKey.mockReturnValue(true);
    render(
      <SessionGate>
        <p>Private chat</p>
      </SessionGate>,
    );
    await expect(
      screen.findByRole('button', { name: 'Unlock messages' }),
    ).resolves.toBeInTheDocument();
    expect(mocks.clearSessionKeys).toHaveBeenCalledOnce();
    expect(mocks.savePublicKey).toHaveBeenCalledWith(bundle.publicKey);
    expect(screen.queryByText('Private chat')).not.toBeInTheDocument();
  });

  it('preserves the already unlocked current-account password-login path', async () => {
    mocks.loadPublicKey.mockReturnValue(bundle.publicKey);
    mocks.hasSessionPrivateKey.mockReturnValue(true);
    render(
      <SessionGate>
        <p>Private chat</p>
      </SessionGate>,
    );
    await expect(
      screen.findByText('Private chat'),
    ).resolves.toBeInTheDocument();
    expect(mocks.clearSessionKeys).not.toHaveBeenCalled();
  });

  it('fails closed if the encrypted bundle cannot be loaded', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('Not authenticated'));
    render(
      <SessionGate>
        <p>Private chat</p>
      </SessionGate>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not authenticated',
    );
    expect(screen.queryByText('Private chat')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.clearSessionKeys).toHaveBeenCalledOnce());
    expect(mocks.clearStorage).toHaveBeenCalledOnce();
  });
});
