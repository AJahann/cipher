'use client';

import { useState } from 'react';
import { AppShell, EmptyState, Sidebar } from '@chat-app/ui-web';
import { ChatPage } from './chat-page';
import { useMe, useUsersList } from '@/lib/data-layer/user';
import { SessionGate } from '@/app/_components/session-gate';
import {
  useChatSocket,
  useChatSocketActions,
  useChatRealtimeSync,
  useCreateConversation,
} from '@/lib/data-layer/chats';

export default function ChatLayout() {
  const { data: me } = useMe();
  const { data: users = [] } = useUsersList();

  const createConversation = useCreateConversation();
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [activeReceiverId, setActiveReceiverId] = useState<string | null>(null);

  const socket = useChatSocket();
  const { joinConversation } = useChatSocketActions();

  // Mounted here rather than inside ChatPage: ChatPage only renders once a
  // conversation is selected, so a user on the empty state would otherwise have
  // no listeners and would miss new contacts and incoming messages entirely.
  useChatRealtimeSync();

  async function handleSelectUser(receiverId: string) {
    const created = await createConversation.mutateAsync({
      memberId: receiverId,
    });
    setActiveConversationId(created.id);
    setActiveReceiverId(receiverId);
    joinConversation?.(created.id);
  }

  return (
    <AppShell
      sidebar={
        <Sidebar
          users={users}
          activeUserId={activeReceiverId}
          onSelect={handleSelectUser}
        />
      }
    >
      <SessionGate>
        {activeConversationId && activeReceiverId && me?.id ? (
          <ChatPage
            conversationId={activeConversationId}
            receiverId={activeReceiverId}
            myId={me.id}
            isConnected={socket?.connected ?? false}
          />
        ) : (
          <EmptyState />
        )}
      </SessionGate>
    </AppShell>
  );
}
