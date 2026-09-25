import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { chatService } from './chat.service';
import { createConversationSchema, getMessagesSchema } from './chat.schema';
import { requireAuth } from '../auth/auth.middleware';

export const chatController = (app: FastifyInstance) => {
  app.addHook('preHandler', requireAuth);

  /** POST /chat/conversations — create or return existing DM conversation */
  app.post('/conversations', async (req, reply) => {
    const { memberId } = createConversationSchema.parse(req.body);
    const conversation = await chatService.createConversation([
      req.session.userId!,
      memberId,
    ]);
    return reply.code(201).send(conversation);
  });

  /** GET /chat/conversations — list conversations for current user */
  app.get('/conversations', async (req, reply) => {
    const conversations = await chatService.listConversations(
      req.session.userId!,
    );
    return reply.send(conversations);
  });

  /** GET /chat/messages?conversationId=&limit=&before= */
  app.get('/messages', async (req, reply) => {
    const { conversationId, limit, before } = getMessagesSchema.parse(
      req.query,
    );
    const result = await chatService.getMessages(
      conversationId,
      req.session.userId!,
      limit,
      before,
    );
    return reply.send(result);
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: 'Validation failed', issues: error.issues });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'FORBIDDEN') {
      return reply
        .code(403)
        .send({ error: 'Not a member of this conversation' });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
};
