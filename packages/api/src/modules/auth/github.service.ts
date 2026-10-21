import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../config/env';
import { db } from '../../db';
import { githubIdentities, githubOAuthAttempts } from '../../db/schema';
import { AppError, isUniqueViolation } from '../../http/errors';

function config() {
  const {
    GITHUB_CLIENT_ID: clientId,
    GITHUB_CLIENT_SECRET: clientSecret,
    GITHUB_REDIRECT_URI: redirectUri,
  } = env;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new AppError('BAD_REQUEST', 'GitHub sign-in is not configured');
  }
  const callback = new URL(redirectUri);
  if (env.NODE_ENV === 'production' && callback.protocol !== 'https:') {
    throw new AppError('BAD_REQUEST', 'GitHub callback must use HTTPS');
  }
  return { clientId, clientSecret, redirectUri };
}

export function createGitHubFlow() {
  const { clientId, redirectUri } = config();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return {
    state,
    verifier,
    url: url.toString(),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  };
}

export const githubFlowStore = {
  async put(
    sessionId: string,
    flow: ReturnType<typeof createGitHubFlow>,
    linkUserId?: string,
  ) {
    await db
      .delete(githubOAuthAttempts)
      .where(lt(githubOAuthAttempts.expiresAt, new Date()));
    const attempt = {
      sessionId,
      state: flow.state,
      verifier: flow.verifier,
      expiresAt: flow.expiresAt,
      linkUserId: linkUserId ?? null,
    };
    await db.insert(githubOAuthAttempts).values(attempt).onConflictDoUpdate({
      target: githubOAuthAttempts.sessionId,
      set: attempt,
    });
  },
  async consume(sessionId: string, suppliedState: unknown) {
    // Consume before validation/network I/O, even for denial/malformed callbacks.
    // A duplicate concurrent callback cannot exchange a second code.
    const [flow] = await db
      .delete(githubOAuthAttempts)
      .where(eq(githubOAuthAttempts.sessionId, sessionId))
      .returning();
    const state = typeof suppliedState === 'string' ? suppliedState : '';
    if (
      !flow ||
      flow.expiresAt.getTime() <= Date.now() ||
      !/^[\w-]{43}$/.test(state) ||
      state.length !== flow.state.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))
    ) {
      throw new AppError(
        'BAD_REQUEST',
        'Invalid or expired GitHub state; start sign-in again',
      );
    }
    return flow;
  },
};

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('bearer'),
});
const identitySchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export async function loadGitHubUserId(
  code: string,
  verifier: string,
): Promise<string> {
  const { clientId, clientSecret, redirectUri } = config();
  try {
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier,
        }),
      },
    );
    if (!response.ok) throw new Error('Token exchange failed');
    // The token only exists in this stack frame. No persistence, response, URL,
    // session field, or logging of token/provider response bodies.
    const { access_token: token } = tokenSchema.parse(await response.json());
    const userResponse = await fetch('https://api.github.com/user', {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cipher',
      },
    });
    if (!userResponse.ok) throw new Error('Identity lookup failed');
    return String(identitySchema.parse(await userResponse.json()).id);
    // oxlint-disable-next-line preserve-caught-error -- Provider errors can carry secrets; intentionally omit their cause.
  } catch {
    // Do not log fetch/Zod exceptions: they can carry upstream credentials/data.
    throw new AppError(
      'INVALID_CREDENTIALS',
      'GitHub authentication failed; start sign-in again',
    );
  }
}

export const githubIdentityStore = {
  async isLinked(userId: string) {
    const [identity] = await db
      .select({ userId: githubIdentities.userId })
      .from(githubIdentities)
      .where(eq(githubIdentities.userId, userId));
    return Boolean(identity);
  },
  async find(githubUserId: string) {
    const [identity] = await db
      .select()
      .from(githubIdentities)
      .where(eq(githubIdentities.githubUserId, githubUserId));
    return identity?.userId;
  },
  async link(githubUserId: string, userId: string) {
    try {
      // Ignore only an identical link. Never transfer a provider id between users.
      await db
        .insert(githubIdentities)
        .values({ githubUserId, userId })
        .onConflictDoNothing();
      const [identity] = await db
        .select()
        .from(githubIdentities)
        .where(
          and(
            eq(githubIdentities.githubUserId, githubUserId),
            eq(githubIdentities.userId, userId),
          ),
        );
      if (!identity)
        throw new AppError(
          'BAD_REQUEST',
          'GitHub identity is already linked to another account, or this account already has a GitHub identity',
        );
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError('BAD_REQUEST', 'GitHub identity is already linked');
      throw error;
    }
  },
};
