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

export interface Message {
  id: string;
  /** Stable client-generated command ID used to make sends idempotent. */
  clientMessageId?: string;
  conversationId: string;
  senderId: string;
  ciphertext: string;
  nonce: string;
  algorithm: string;
  createdAt: string;
  sender?: Pick<User, 'id' | 'username'>;
}

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

export interface SendMessagePayload {
  clientMessageId: string;
  conversationId: string;
  ciphertext: string;
  nonce: string;
  algorithm: string;
}

export interface RegisterUserPayload {
  username: string;
  password: string;
  publicKey: string;
  wrappedPrivateKey: {
    ciphertext: string;
    salt: string;
    nonce: string;
  };
}

export interface LoginUserPayload {
  username: string;
  password: string;
}
