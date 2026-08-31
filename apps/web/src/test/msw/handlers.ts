import { http, HttpResponse } from 'msw';

export const stubConversation = {
  id: 'conv-1',
  memberIds: ['user-a', 'user-b'],
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const stubMessage = {
  id: 'msg-1',
  conversationId: 'conv-1',
  senderId: 'user-a',
  content: 'hello',
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const stubUser = {
  id: 'user-a',
  username: 'ashkan',
  publicKey: 'pk-abc',
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const CONV_PATH = /\/chat\/conversations$/;
export const MESSAGES_PATH = /\/chat\/messages/;
export const ME_PATH = /\/auth\/me$/;

export const handlers = [
  http.get(CONV_PATH, () => HttpResponse.json([stubConversation])),
  http.get(MESSAGES_PATH, () => HttpResponse.json([stubMessage])),
  http.get(ME_PATH, () => HttpResponse.json(stubUser)),
];
