import type { ApiErrorBody } from './errors';
import type {
  ConversationRef,
  MessageDto,
  MessageReadInput,
  SendMessageAck,
  SendMessageInput,
} from './chat';
import type { UserSummary } from './user';

export interface PresenceState {
  userId: string;
  status: 'online' | 'offline' | 'unknown';
  /** null is unknown, never an inferred offline result during an outage. */
  online: boolean | null;
}

/** Events the server emits. Shared by the Socket.IO server and client. */
export interface ServerToClientEvents {
  'message:new': (message: MessageDto) => void;
  /** Message + outbox intent committed; does not assert peer delivery/read. */
  'message:ack': (data: {
    clientMessageId: string;
    message: MessageDto;
  }) => void;
  'conversation:updated': (data: {
    conversationId: string;
    message: MessageDto;
  }) => void;
  'user:new': (user: UserSummary) => void;
  'typing:indicator': (data: {
    conversationId: string;
    userId: string;
    isTyping: boolean;
  }) => void;
  'presence:update': (data: PresenceState) => void;
  'presence:snapshot': (data: {
    states: PresenceState[];
    availability: 'available' | 'unknown';
  }) => void;
  /** Rejection of a fire-and-forget client event (one without an ack). */
  error: (data: {
    event: keyof ClientToServerEvents;
    error: ApiErrorBody;
  }) => void;
}

/** Events the client emits. Payloads are validated with the zod schemas. */
export interface ClientToServerEvents {
  'presence:sync': () => void;
  'message:send': (
    data: SendMessageInput,
    ack: (result: SendMessageAck) => void,
  ) => void;
  'typing:start': (data: ConversationRef) => void;
  'typing:stop': (data: ConversationRef) => void;
  'message:read': (data: MessageReadInput) => void;
  'conversation:join': (data: ConversationRef) => void;
  'conversation:leave': (data: ConversationRef) => void;
}
