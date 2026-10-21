import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env';
import { destroySession } from '../../db/session';
import { AppError } from '../../http/errors';
import { userService } from '../user/user.service';
import { requireAuth } from './auth.middleware';
import {
  createGitHubFlow,
  githubFlowStore,
  githubIdentityStore,
  loadGitHubUserId,
} from './github.service';

export const githubController = (app: FastifyInstance) => {
  // Auth redirects and errors must not be cached or leak callback queries via Referer.
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/', async (req, reply) => {
    const flow = createGitHubFlow();
    await req.session.save();
    await githubFlowStore.put(req.session.sessionId, flow);
    return reply.redirect(flow.url);
  });

  // Linking is explicit, authenticated, and CSRF-protected. A login flow never
  // implicitly links accounts, even if started with an authenticated cookie.
  app.post('/link', { preHandler: requireAuth }, async (req, reply) => {
    if (req.headers.origin !== env.CLIENT_ORIGIN) {
      throw new AppError('BAD_REQUEST', 'Link GitHub from the Cipher app');
    }
    const flow = createGitHubFlow();
    await req.session.save();
    await githubFlowStore.put(req.session.sessionId, flow, req.session.userId!);
    return reply.send({ authorizeUrl: flow.url });
  });

  app.get('/callback', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const flow = await githubFlowStore.consume(
      req.session.sessionId,
      query.state,
    );
    if (query.error !== undefined)
      throw new AppError(
        'INVALID_CREDENTIALS',
        'GitHub sign-in was denied; start sign-in again',
      );
    const code = z.string().min(1).max(1024).parse(query.code);
    if (flow.linkUserId && req.session.userId !== flow.linkUserId) {
      throw new AppError('UNAUTHENTICATED');
    }
    const githubUserId = await loadGitHubUserId(code, flow.verifier);
    let userId = await githubIdentityStore.find(githubUserId);
    if (flow.linkUserId) {
      await githubIdentityStore.link(githubUserId, flow.linkUserId);
      userId = flow.linkUserId;
    }
    if (!userId || !(await userService.findById(userId))) {
      // Unknown identities are refused, not provisioned without encryption keys.
      throw new AppError(
        'INVALID_CREDENTIALS',
        'GitHub account is not linked. Sign in with your Cipher passphrase, then link GitHub from the chat screen.',
      );
    }
    const previousSessionId = req.session.sessionId;
    await req.session.regenerate();
    await destroySession(previousSessionId);
    req.session.userId = userId;
    await req.session.save();
    // Fixed application destination; never accept a callback returnTo parameter.
    return reply.redirect(new URL('/chat', env.CLIENT_ORIGIN).toString());
  });
};
