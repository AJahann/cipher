/* oxlint-disable no-await-in-loop -- Session authority is checked immediately before each socket emission. */
import type { Store } from 'express-session';
import { db } from '../db';
import { chatService } from '../modules/chat/chat.service';
import type { AppIO } from '../modules/chat/chat.socket';
import type { MessageDto } from '@chat-app/shared/contracts';
import { eq } from 'drizzle-orm';
import { messages } from '../db/schema';

/** Runs inside the ONE supported messenger API, sharing its in-memory io. */
export function messageNotifier(io: AppIO, store: Store) {
  return async (messageId: string) => {
    const message = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
      with: { sender: { columns: { id: true, username: true } } },
    });
    if (!message) throw new Error('NOTIFICATION_MESSAGE_MISSING');
    const payload: MessageDto = {
      ...message,
      createdAt: message.createdAt.toISOString(),
    };
    const members = new Set(
      await chatService.getConversationMembers(message.conversationId),
    );
    // Do not trust stale conversation rooms or Redis presence as receive authority.
    for (const socket of io.sockets.sockets.values()) {
      if (!members.has(socket.data.userId)) continue;
      const session = await new Promise<Record<string, any> | null>(
        (resolve, reject) => {
          store.get(socket.data.sessionId, (error, value) =>
            error ? reject(error) : resolve(value ?? null),
          );
        },
      );
      if (
        !session ||
        session.userId !== socket.data.userId ||
        (session.cookie?.expires &&
          new Date(session.cookie.expires).getTime() <= Date.now())
      ) {
        socket.disconnect(true);
        continue;
      }
      if (!socket.connected) continue;
      socket.join(`conv:${message.conversationId}`);
      if (socket.data.userId !== message.senderId)
        socket.emit('conversation:updated', {
          conversationId: message.conversationId,
          message: payload,
        });
      socket.emit('message:new', payload);
    }
    // Successful local emit/no online sockets is not proof of peer delivery/read.
  };
}
