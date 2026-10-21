/* oxlint-disable vitest/prefer-import-in-mock -- Deliberately partial hook/component fakes do not implement the full production return types. */
/* oxlint-disable require-await -- Async interface mocks intentionally resolve without real I/O. */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatLayout from './chat-layout';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  confirm: vi.fn(),
  messages: [] as any[],
  decrypt: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/data-layer/user', () => ({
  useMe: () => ({ data: { id: 'me' } }),
  useAuthConfig: () => ({ data: { githubEnabled: false } }),
  useGitHubLinkStatus: () => ({}),
  useDirectory: () => ({
    data: [
      { id: 'alice', username: 'Alice' },
      { id: 'bob', username: 'Bob' },
    ],
  }),
  useUserPublicKey: () => ({ data: { publicKey: 'key' }, isLoading: false }),
}));
vi.mock('@/lib/data-layer/chats', () => ({
  chatKeys: {
    messagesRoot: () => ['chat', 'messages'],
    historyRoot: () => ['chat', 'history'],
  },
  useMessageHistory: () => ({
    data: mocks.messages,
    isLoading: false,
    isError: false,
  }),
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
  encryptChatMessage: async () => ({
    ciphertext: 'encrypted',
    nonce: 'nonce',
    algorithm: 'cipher-v1-x25519-xsalsa20-poly1305',
  }),
  decryptChatMessage: (...args: any[]) => mocks.decrypt(...args),
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
vi.mock('./github-link-button', () => ({
  GitHubLinkButton: () => null,
}));
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

beforeEach(() => {
  mocks.messages = [];
  mocks.decrypt.mockResolvedValue('decrypted');
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
  it('keeps an undecryptable message visible as an explicit failure', async () => {
    mocks.messages = [
      {
        id: 'message',
        clientMessageId: 'command',
        senderId: 'alice',
        conversationId: 'conv-alice',
        ciphertext: 'bad',
        nonce: 'bad',
        algorithm: 'unknown',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    mocks.decrypt.mockRejectedValue(new Error('tampered'));
    render(<ChatLayout />);
    fireEvent.click(screen.getByText('Alice'));
    await waitFor(() =>
      expect(screen.getByTestId('messages')).toHaveTextContent(
        'Unable to decrypt or verify this message',
      ),
    );
  });
});
