import { http, HttpResponse } from 'msw';

export const stubConversation = {
  id: 'conv-1',
  memberIds: ['user-a', 'user-b'],
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const CONV_PATH = /\/chat\/conversations$/;

export const handlers = [
  http.get(CONV_PATH, () => HttpResponse.json([stubConversation])),
];
