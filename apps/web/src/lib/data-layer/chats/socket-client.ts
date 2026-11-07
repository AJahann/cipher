import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@chat-app/shared/contracts';
import { getApiOrigin } from '../api-origin';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let instance: AppSocket | null = null;
export function getSocket() {
  instance ??= io(getApiOrigin(), {
    withCredentials: true,
    autoConnect: false,
  });
  return instance;
}
export function disconnectChatSocket() {
  instance?.disconnect();
  // Existing mounted hooks retain this disconnected instance until unmount;
  // a new authenticated tree must receive a fresh handshake and listeners.
  instance = null;
}
