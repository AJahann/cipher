/* eslint-disable @typescript-eslint/ban-ts-comment */
'use client';

import { useMemo, useState } from 'react';
import Sidebar from './sidebar';
import { ChatPage } from './chat-page';
import { useMe, useUsersList } from '@/lib/data-layer/user';
import {
  useChatSocket,
  useChatSocketActions,
  useChatSocketEvents,
  useCreateConversation,
} from '@/lib/data-layer/chats';

const EmptyState = () => (
  <main className='flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm'>
    Select a conversation
  </main>
);

export default function ChatLayout() {
  const { data: me } = useMe();

  const { data: usersData } = useUsersList();
  const users = useMemo(() => {
    if (!usersData) return [];
    // supports both paginated + non‑paginated
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

  async function createConversationHandler(receiverId: string) {
    const created = await createConversation.mutateAsync({
      memberId: receiverId,
    });

    setActiveConversationId(created.id);
    setActiveReceiverId(receiverId);
    joinConversation?.(created.id);
  }

  return (
    <div className='flex h-screen bg-white dark:bg-neutral-900 font-sans'>
      <Sidebar
        setActiveChatId={(id) => createConversationHandler(id)}
        chatList={users} // users list
      />

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
    </div>
  );
}
