import type {
  LoginUserInput,
  MessageDto,
  RegisterUserInput,
} from '../contracts';

export interface User {
  id: string;
  username: string;
  createdAt: string;
  publicKey: string;
  wrappedPrivateKey: {
    ciphertext: string;
    salt: string;
    nonce: string;
  };
}

/** A stored message. Derived from the wire contract, not redeclared. */
export type Message = Omit<MessageDto, 'sender'> & {
  sender?: MessageDto['sender'];
};

export interface Conversation {
  id: string;
  createdAt: string;
  members?: ConversationMember[];
}

export interface ConversationMember {
  id: string;
  conversationId: string;
  userId: string;
  user?: Pick<User, 'id' | 'username'>;
}

// Request payloads are the zod contracts' inferred types; there is no second,
// hand-written definition to drift from what the server parses.
export type RegisterUserPayload = RegisterUserInput;
export type LoginUserPayload = LoginUserInput;
