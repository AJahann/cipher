/* eslint-disable @typescript-eslint/ban-ts-comment */
'use client';

import { useMemo, useState } from 'react';
import { AppShell, EmptyState, Sidebar } from '@chat-app/ui-web';
import { ChatPage } from './chat-page';
import { useMe, useUsersList } from '@/lib/data-layer/user';
import {
  useChatSocket,
  useChatSocketActions,
  useChatSocketEvents,
  useCreateConversation,
} from '@/lib/data-layer/chats';

export default function ChatLayout() {
  const { data: me } = useMe();
  const { data: usersData } = useUsersList();

  const users = useMemo(() => {
    if (!usersData) return [];
    // supports both paginated + non-paginated responses
    // @ts-ignore
    return Array.isArray(usersData?.pages)
      ? // @ts-ignore
        usersData.pages.flat()
      : // @ts-ignore
        usersData;
  }, [usersData]);

  const createConversation = useCreateConversation();
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [activeReceiverId, setActiveReceiverId] = useState<string | null>(null);

  const socket = useChatSocket();
  const { joinConversation } = useChatSocketActions();
  useChatSocketEvents({});

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
    </AppShell>
  );
}
