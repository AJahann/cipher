import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), confirm: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/data-layer/user', () => ({
  useMe: () => ({ data: { id: 'me' } }),
  useAuthConfig: () => ({ data: { githubEnabled: false } }),
  useGitHubLinkStatus: () => ({}),
  useUsersList: () => ({
    data: [
      { id: 'alice', username: 'Alice' },
      { id: 'bob', username: 'Bob' },
    ],
  }),
  useUserPublicKey: () => ({ data: { publicKey: 'key' }, isLoading: false }),
}));
vi.mock('@/lib/data-layer/chats', () => ({
  chatKeys: { messagesRoot: () => ['chat', 'messages'] },
  useMessages: () => ({ data: [], isLoading: false, isError: false }),
  useChatSocket: () => ({ connected: true }),
  useChatSocketActions: () => ({ joinConversation: vi.fn() }),
  useChatRealtimeSync: vi.fn(),
  useCreateConversation: () => ({
    mutateAsync: async ({ memberId }: any) => ({ id: `conv-${memberId}` }),
  }),
}));
vi.mock('@/lib/data-layer/chats/use-chat-socket', () => ({
  useChatSocketActions: () => ({
    sendMessage: mocks.send,
    typingStart: vi.fn(),
    typingStop: vi.fn(),
  }),
  useChatRealtimeMessages: vi.fn(),
}));
vi.mock('@chat-app/shared/crypto', () => ({
  getSessionPrivateKey: () => new Uint8Array(32),
  E2EEncryption: {
    encryptMessage: async () => ({
      ciphertext: 'encrypted',
      nonce: 'nonce',
      algorithm: 'x25519-xsalsa20-poly1305',
    }),
    decryptMessage: async () => '',
  },
}));
vi.mock('@/lib/keyStorage', () => ({
  KeyStorage: { loadPublicKeyRaw: async () => new Uint8Array(32) },
}));
vi.mock('@chat-app/shared', () => ({
  KeyManager: { fromBase64: async () => new Uint8Array(32) },
}));
vi.mock('@/app/_components/session-gate', () => ({
  SessionGate: ({ children }: any) => children,
}));
vi.mock('./github-link-button', () => ({ GitHubLinkButton: () => null }));
vi.mock('./logout-button', () => ({ LogoutButton: () => null }));
vi.mock('@chat-app/ui-web', () => ({
  AppShell: ({ sidebar, children }: any) => (
    <>
      {sidebar}
      {children}
    </>
  ),
  EmptyState: () => null,
  Sidebar: ({ users, onSelect }: any) => (
    <>
      {users.map((u: any) => (
        <button key={u.id} onClick={() => onSelect(u.id)}>
          {u.username}
        </button>
      ))}
    </>
  ),
  ChatHeader: ({ title }: any) => <h2>{title}</h2>,
  ChatInput: ({ value, onChange, onSend }: any) => (
    <>
      <input
        aria-label='draft'
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button onClick={onSend}>send</button>
    </>
  ),
  MessageList: ({ messages }: any) => (
    <div data-testid='messages'>{JSON.stringify(messages)}</div>
  ),
}));
import ChatLayout from './chat-layout';
beforeEach(() => {
  mocks.send.mockRejectedValue(new Error('MESSAGE_ACK_TIMEOUT'));
  mocks.confirm.mockReturnValue(true);
  vi.stubGlobal('confirm', mocks.confirm);
});
describe('conversation isolation', () => {
  it('clears a previous contact draft after confirmed navigation', async () => {
    render(<ChatLayout />);
    fireEvent.click(screen.getByText('Alice'));
    await screen.findByRole('heading', { name: 'Alice' });
    fireEvent.change(screen.getByLabelText('draft'), {
      target: { value: 'private draft for Alice' },
    });
    fireEvent.click(screen.getByText('Bob'));
    await screen.findByRole('heading', { name: 'Bob' });
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('draft')).toHaveValue('');
  });
  it('does not show a previous conversation failed outbox under the next header', async () => {
    render(<ChatLayout />);
    fireEvent.click(screen.getByText('Alice'));
    await screen.findByRole('heading', { name: 'Alice' });
    fireEvent.change(screen.getByLabelText('draft'), {
      target: { value: 'private message for Alice' },
    });
    fireEvent.click(screen.getByText('send'));
    await waitFor(() =>
      expect(screen.getByTestId('messages')).toHaveTextContent('failed'),
    );
    fireEvent.click(screen.getByText('Bob'));
    await screen.findByRole('heading', { name: 'Bob' });
    expect(screen.getByTestId('messages')).not.toHaveTextContent(
      'private message for Alice',
    );
  });
  it('preserves the draft when discarding is cancelled', async () => {
    mocks.confirm.mockReturnValue(false);
    render(<ChatLayout />);
    fireEvent.click(screen.getByText('Alice'));
    await screen.findByRole('heading', { name: 'Alice' });
    fireEvent.change(screen.getByLabelText('draft'), {
      target: { value: 'keep me' },
    });
    fireEvent.click(screen.getByText('Bob'));
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeVisible();
    expect(screen.getByLabelText('draft')).toHaveValue('keep me');
  });
});
