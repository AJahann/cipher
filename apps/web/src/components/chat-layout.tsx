'use client';

import { useRef, useState } from 'react';
import { AppShell, EmptyState, Sidebar } from '@chat-app/ui-web';
import { GitHubLinkButton } from './github-link-button';
import { ChatPage } from './chat-page';
import { LogoutButton } from './logout-button';
import {
  useAuthConfig,
  useGitHubLinkStatus,
  useMe,
  useDirectory,
} from '@/lib/data-layer/user';
import { SessionGate } from '@/app/_components/session-gate';
import {
  useChatSocket,
  useChatSocketActions,
  useChatRealtimeSync,
  useCreateConversation,
} from '@/lib/data-layer/chats';

export default function ChatLayout() {
  const { data: me } = useMe();
  const { data: authConfig } = useAuthConfig();
  const githubEnabled = authConfig?.githubEnabled === true;
  const { data: githubLinkStatus } = useGitHubLinkStatus(me?.id, githubEnabled);
  const directory = useDirectory(me?.id);
  const users = directory.data ?? [];

  const createConversation = useCreateConversation();
  const selectInFlight = useRef(false);
  const hasUnsent = useRef(false);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [activeReceiverId, setActiveReceiverId] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const socket = useChatSocket();
  const { joinConversation } = useChatSocketActions();
  useChatRealtimeSync();

  async function handleSelectUser(receiverId: string) {
    if (selectInFlight.current || receiverId === activeReceiverId) return;
    if (
      hasUnsent.current &&
      !window.confirm(
        'Switch conversation and discard this draft or unsent messages?',
      )
    )
      return;
    selectInFlight.current = true;
    setPendingUserId(receiverId);
    setSelectionError(null);

    try {
      const created = await createConversation.mutateAsync({
        memberId: receiverId,
      });
      hasUnsent.current = false;
      setActiveConversationId(created.id);
      setActiveReceiverId(receiverId);
      joinConversation(created.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to open conversation';
      setSelectionError(message);
    } finally {
      selectInFlight.current = false;
      setPendingUserId(null);
    }
  }

  const activeReceiverName =
    users.find((u) => u.id === activeReceiverId)?.username ?? 'Chat';

  return (
    <AppShell
      sidebar={
        <Sidebar
          users={users}
          activeUserId={activeReceiverId}
          pendingUserId={pendingUserId}
          errorMessage={selectionError}
          onSelect={handleSelectUser}
          hasMore={directory.hasNextPage}
          loadingMore={directory.isFetchingNextPage}
          onLoadMore={() => {
            void directory.fetchNextPage();
          }}
          footer={
            <>
              {githubEnabled && (
                <GitHubLinkButton linked={githubLinkStatus?.linked} />
              )}
              <LogoutButton />
            </>
          }
        />
      }
    >
      <SessionGate>
        {activeConversationId && activeReceiverId && me?.id ? (
          <ChatPage
            key={`${me.id}:${activeConversationId}`}
            onUnsentChange={(value) => {
              hasUnsent.current = value;
            }}
            conversationId={activeConversationId}
            receiverId={activeReceiverId}
            receiverName={activeReceiverName}
            myId={me.id}
            isConnected={socket.connected}
          />
        ) : (
          <EmptyState />
        )}
      </SessionGate>
    </AppShell>
  );
}
