import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  disconnect: vi.fn(),
  publicKey: vi.fn(),
}));
vi.mock('@chat-app/shared/crypto', () => ({ clearSessionKeys: mocks.clear }));
vi.mock('./keyStorage', () => ({ KeyStorage: { clear: mocks.publicKey } }));
vi.mock('./data-layer/chats/socket-client', () => ({
  disconnectChatSocket: mocks.disconnect,
}));
import { clearClientSession, SESSION_CHANGE_EVENT } from './client-session';
describe('session teardown', () => {
  it('cancels private queries, removes account state, keys and transport, then notifies tabs', async () => {
    const client = new QueryClient();
    client.setQueryData(['chat', 'messages'], ['old-account-ciphertext']);
    client.setQueryData(['user', 'me'], { id: 'old' });
    await clearClientSession(client);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(mocks.clear).toHaveBeenCalled();
    expect(mocks.publicKey).toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_CHANGE_EVENT)).toBeTruthy();
  });
  it('does not create a cross-tab notification loop', async () => {
    localStorage.removeItem(SESSION_CHANGE_EVENT);
    await clearClientSession(new QueryClient(), false);
    expect(localStorage.getItem(SESSION_CHANGE_EVENT)).toBeNull();
  });
});
