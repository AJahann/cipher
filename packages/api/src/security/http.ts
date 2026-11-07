import type { FastifyInstance } from 'fastify';
import { AppError } from '../http/errors';
import type { SecurityBudgets } from './policy';
import { isOriginAllowed } from './origins';

export function registerHttpSecurity(
  app: FastifyInstance,
  budgets: SecurityBudgets,
  allowedOrigins: string | string[],
) {
  const origins = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : [allowedOrigins];
  // Register BEFORE cookie/session plugins: refuse avoidable parsing/store/hash work.
  app.addHook('onRequest', (req, reply, done) => {
    reply.header('Cache-Control', 'no-store');
    budgets.take('ip.http', req.ip);
    const path = req.routeOptions.url ?? req.url.split('?')[0];
    if (path === '/auth/login' || path === '/auth/register')
      budgets.take('ip.password', req.ip);
    if (path === '/auth/github' || path.startsWith('/auth/github/'))
      budgets.take('ip.github', req.ip);
    // Absent Origin supports non-browser clients. "null", malformed and foreign
    // origins are refused, not merely omitted from CORS response headers.
    const host =
      (req.headers['x-forwarded-host'] as string) || req.headers.host;
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin !== undefined &&
      !isOriginAllowed(req.headers.origin, origins, host)
    )
      throw new AppError('BAD_REQUEST', 'Untrusted request origin');
    done();
  });
  app.addHook('preHandler', (req, _reply, done) => {
    const { userId } = req.session;
    if (!userId) return done(); // Route auth still rejects protected anonymous requests.
    const budget =
      req.method === 'GET' || req.method === 'HEAD'
        ? 'account.read'
        : req.method === 'POST' &&
            req.routeOptions.url === '/chat/conversations'
          ? 'account.conversation'
          : 'account.mutation';
    try {
      budgets.take(budget, userId);
    } catch (error) {
      // The request ends here. Drop ONLY this request's session reference so
      // @fastify/session's onSend hook cannot perform an avoidable rolling save.
      // Its runtime supports null (also used after destroy); its types do not.
      // Do not destroy/revoke the stored session or clear the browser cookie.
      (req as { session: typeof req.session | null }).session = null;
      throw error;
    }
    done();
  });
}
