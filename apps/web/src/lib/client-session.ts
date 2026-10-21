import type { QueryClient } from '@tanstack/react-query';
import { clearSessionKeys } from '@chat-app/shared/crypto';
import { KeyStorage } from './keyStorage';
import { disconnectChatSocket } from './data-layer/chats/socket-client';

export const SESSION_CHANGE_EVENT = 'cipher:session-change';
export async function clearClientSession(
  client: QueryClient,
  notifyOtherTabs = true,
) {
  disconnectChatSocket();
  clearSessionKeys();
  KeyStorage.clear();
  await client.cancelQueries();
  client.clear();
  if (notifyOtherTabs)
    localStorage.setItem(SESSION_CHANGE_EVENT, crypto.randomUUID());
}
