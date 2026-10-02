import type { FastifyInstance } from 'fastify';
import {
  createConversationSchema,
  listMessagesQuerySchema,
} from '@chat-app/shared/contracts';
import { chatService } from './chat.service';
import { userService } from '../user/user.service';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../../http/errors';

export const chatController = (app: FastifyInstance) => {
  app.addHook('preHandler', requireAuth);

  /**
   * POST /chat/conversations — get-or-create the DM with `memberId`.
   * 201 when this call created it, 200 when it already existed.
   */
  app.post('/conversations', async (req, reply) => {
    const { memberId } = createConversationSchema.parse(req.body);
    const userId = req.session.userId!;
    if (memberId === userId) throw new AppError('INVALID_MEMBER');
    if (!(await userService.findById(memberId))) {
      throw new AppError('USER_NOT_FOUND');
    }

    const { conversation, created } =
      await chatService.getOrCreateDirectConversation(userId, memberId);
    return reply
      .code(created ? 201 : 200)
      .send({ id: conversation.id, createdAt: conversation.createdAt });
  });

  /** GET /chat/conversations — list conversations for current user */
  app.get('/conversations', async (req, reply) => {
    const conversations = await chatService.listConversations(
      req.session.userId!,
    );
    return reply.send(conversations);
  });

  /** GET /chat/messages?conversationId=&limit=&cursor= */
  app.get('/messages', async (req, reply) => {
    const { conversationId, limit, cursor } = listMessagesQuerySchema.parse(
      req.query,
    );
    const page = await chatService.getMessages(
      conversationId,
      req.session.userId!,
      limit,
      cursor,
    );
    return reply.send(page);
  });
};
