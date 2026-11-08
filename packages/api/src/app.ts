import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env';
import { githubController } from './modules/auth/github.controller';
import { authController } from './modules/auth/auth.controller';
import { userController } from './modules/user/user.controller';
import { chatController } from './modules/chat/chat.controller';
import { registerChatSocket } from './modules/chat/chat.socket';
import { sessionStore } from './db/session';
import { registerErrorHandling, AppError } from './http/errors';
import { RedisRuntime } from './redis/runtime';
import { DirectoryCache } from './redis/directory-cache';
import { Presence } from './redis/presence';
import {
  NotificationJobs,
  type NotificationOptions,
} from './jobs/notification-jobs';
import { messageNotifier } from './jobs/notify-message';
import { pool } from './db';
import {
  HTTP_BODY_BYTES,
  SOCKET_PAYLOAD_BYTES,
  SecurityBudgets,
} from './security/policy';
import { registerHttpSecurity } from './security/http';
import { isOriginAllowed } from './security/origins';
import { securityLogger } from './security/logging';
import {
  formatTraceparent,
  generateTraceId,
  parseTraceparent,
  sanitizeRequestId,
  TRACEPARENT_HEADER,
  REQUEST_ID_HEADER,
} from '@chat-app/shared/telemetry';
import {
  runWithTraceContext,
  startSpan,
  type ActiveTraceContext,
  type SpanHandle,
} from './telemetry/tracer';
import { initApiSentry } from './telemetry/sentry';
import {
  pushLogRecord,
  registerTelemetryDashboard,
} from './telemetry/dashboard';

/* oxlint-disable max-lines-per-function */
export const buildApp = async (
  jobOptions: Partial<
    Pick<
      NotificationOptions,
      | 'beforeEffect'
      | 'afterEnqueue'
      | 'afterEffect'
      | 'leaseMs'
      | 'reconcileMs'
      | 'lockMs'
      | 'autoDispatch'
      | 'autoRun'
    >
  > = {},
  securityOptions: { now?: () => number } = {},
) => {
  initApiSentry();

  const app = Fastify({
    bodyLimit: HTTP_BODY_BYTES,
    trustProxy: false, // No forwarded IP authority without a reviewed proxy policy.
    logger: securityLogger,
  });

  app.addHook('onRequest', (req, _reply, done) => {
    const rawTrace = req.headers[TRACEPARENT_HEADER];
    const incomingTrace = parseTraceparent(
      Array.isArray(rawTrace) ? rawTrace[0] : rawTrace,
    );
    const traceId = incomingTrace?.traceId ?? generateTraceId();
    const parentSpanId = incomingTrace?.spanId;
    const rawReqId = req.headers[REQUEST_ID_HEADER];
    const requestId = sanitizeRequestId(
      Array.isArray(rawReqId) ? rawReqId[0] : rawReqId,
    );

    req.id = requestId;

    const route = req.routeOptions.url ?? req.url.split('?')[0];
    const span = startSpan(`http.server ${req.method} ${route}`, {
      kind: 'server',
      traceId,
      parentSpanId,
      attributes: {
        'http.method': req.method,
        'http.route': route,
      },
    });

    const context: ActiveTraceContext = {
      traceId,
      spanId: span.spanId,
      requestId,
      parentSpanId,
    };

    (req as unknown as { traceContext: ActiveTraceContext }).traceContext =
      context;
    (req as unknown as { serverSpan: SpanHandle }).serverSpan = span;

    runWithTraceContext(context, () => {
      done();
    });
  });

  app.addHook('onSend', (req, reply, _payload, done) => {
    const ctx = (req as unknown as { traceContext?: ActiveTraceContext })
      .traceContext;
    if (ctx) {
      reply.header(REQUEST_ID_HEADER, ctx.requestId);
      reply.header(
        TRACEPARENT_HEADER,
        formatTraceparent(ctx.traceId, ctx.spanId),
      );
    }
    done();
  });

  app.addHook('onResponse', (req, reply, done) => {
    const ctx = (req as unknown as { traceContext?: ActiveTraceContext })
      .traceContext;
    const span = (req as unknown as { serverSpan?: SpanHandle }).serverSpan;
    if (span) {
      span.end(reply.statusCode < 500 ? 'ok' : 'error');
    }

    const duration_ms = Number(reply.elapsedTime.toFixed(2));
    const route = req.routeOptions.url ?? req.url.split('?')[0];
    const logData = {
      requestId: req.id,
      traceId: ctx?.traceId,
      spanId: ctx?.spanId,
      route,
      method: req.method,
      status: reply.statusCode,
      duration_ms,
    };
    pushLogRecord(logData);
    req.log.info(logData, 'request completed');
    done();
  });

  const budgets = new SecurityBudgets(securityOptions.now);
  app.decorate('securityBudgets', budgets);
  const allowedOrigins = env.CLIENT_ORIGIN.split(',').map((o) => o.trim());
  registerHttpSecurity(app, budgets, allowedOrigins);

  // Socket.IO can only attach once the HTTP server is ready, but the REST
  // handlers registered below need to emit on it at request time (e.g. telling
  // connected clients that a new account was created). A getter decorator hands
  // them a late-bound reference instead of capturing `null` forever.
  let io: SocketIOServer | null = null;
  app.decorate('io', { getter: () => io });
  const redis = new RedisRuntime(env.REDIS_URL, env.REDIS_NAMESPACE);
  const presence = new Presence(redis, env.PRESENCE_LEASE_MS);
  app.decorate('redisRuntime', redis);
  app.decorate('directoryCache', new DirectoryCache(redis));
  app.addHook('onClose', async () => {
    await notificationJobs.close();
    presence.close();
    await redis.quit();
  });

  // One error envelope for every route, registered before any plugin.
  registerErrorHandling(app);
  registerTelemetryDashboard(app);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || isOriginAllowed(origin, allowedOrigins)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  });

  app.register(cookie, {
    secret: env.SESSION_SECRET,
  });
  app.register(session, {
    secret: env.SESSION_SECRET,

    store: sessionStore,
    cookieName: 'sessionId',
    cookie: {
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      sameSite: 'lax',
    },
    // Preserve sliding expiry; the store prevents stale saves after revocation.
    rolling: true,
    saveUninitialized: false,
  });

  app.get('/health', () => ({ status: 'ok' }));

  app.get('/telemetry/test-error', () => {
    throw new AppError(
      'INTERNAL',
      'Deliberate test error for Sentry verification',
    );
  });

  app.register(authController, { prefix: '/auth' });
  app.register(githubController, { prefix: '/auth/github' });
  app.register(userController, { prefix: '/users' });
  app.register(chatController, { prefix: '/chat' });

  await app.ready();

  const socketServer = new SocketIOServer(app.server, {
    maxHttpBufferSize: SOCKET_PAYLOAD_BYTES,
    perMessageDeflate: false,
    allowRequest: (req, accept) => {
      try {
        budgets.take('ip.handshake', req.socket.remoteAddress ?? 'unknown');
        const reqOrigin = req.headers.origin;
        const host =
          (req.headers['x-forwarded-host'] as string) || req.headers.host;
        accept(
          null,
          Boolean(
            reqOrigin && isOriginAllowed(reqOrigin, allowedOrigins, host),
          ),
        );
      } catch (_error) {
        accept(null, false);
      }
    },
    cors: {
      origin: (origin, callback) => {
        if (!origin || isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
  });

  io = socketServer;

  registerChatSocket(socketServer, app.log, sessionStore, { app, presence });

  const notificationJobs = new NotificationJobs({
    ...jobOptions,
    redisUrl: env.REDIS_URL,
    namespace: env.REDIS_NAMESPACE,
    pool,
    notify: messageNotifier(socketServer, sessionStore),
  });
  return { app, io: socketServer, notificationJobs };
};
