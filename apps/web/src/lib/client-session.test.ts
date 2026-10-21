/* oxlint-disable vitest/prefer-import-in-mock -- Deliberately partial hook/component fakes do not implement the full production return types. */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { clearClientSession, SESSION_CHANGE_EVENT } from './client-session';

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  disconnect: vi.fn(),
  publicKey: vi.fn(),
}));
vi.mock('@chat-app/shared/crypto', () => ({
  clearSessionKeys: mocks.clear,
}));
vi.mock('./keyStorage', () => ({
  KeyStorage: { clear: mocks.publicKey },
}));
vi.mock('./data-layer/chats/socket-client', () => ({
  disconnectChatSocket: mocks.disconnect,
}));

describe('session teardown', () => {
  it('cancels private queries, removes account state, keys and transport, then notifies tabs', async () => {
    const client = new QueryClient();
    client.setQueryData(['chat', 'messages'], ['old-account-ciphertext']);
    client.setQueryData(['user', 'me'], { id: 'old' });
    await clearClientSession(client);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(mocks.clear).toHaveBeenCalledWith();
    expect(mocks.publicKey).toHaveBeenCalledWith();
    expect(mocks.disconnect).toHaveBeenCalledWith();
    expect(localStorage.getItem(SESSION_CHANGE_EVENT)).toBeTruthy();
  });
  it('does not create a cross-tab notification loop', async () => {
    localStorage.removeItem(SESSION_CHANGE_EVENT);
    await clearClientSession(new QueryClient(), false);
    expect(localStorage.getItem(SESSION_CHANGE_EVENT)).toBeNull();
  });
});
