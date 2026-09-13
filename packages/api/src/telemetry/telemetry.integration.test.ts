/* oxlint-disable max-lines-per-function, require-await, complexity, vitest/no-conditional-in-test, vitest/prefer-expect-type-of, eslint/max-nested-callbacks */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, {
  type FastifyRequest,
  type FastifyReply,
  type HookHandlerDoneFunction,
} from 'fastify';
import { Writable } from 'node:stream';
import {
  formatTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  REQUEST_ID_HEADER,
  TRACEPARENT_HEADER,
} from '@chat-app/shared/telemetry';
import {
  clearRecordedSpans,
  getAllRecordedSpans,
  getTraceSpans,
  runWithTraceContext,
  startSpan,
} from './tracer';
import { clearCapturedSentryEvents, getCapturedSentryEvents } from './sentry';
import { instrumentPgPool } from './db-tracer';
import { registerErrorHandling, AppError } from '../http/errors';
import { securityLogger } from '../security/logging';
import type { Pool } from 'pg';

describe('Day 24: End-to-end Telemetry & Correlation', () => {
  let logLines: Record<string, unknown>[] = [];
  let stream: Writable;
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    clearRecordedSpans();
    clearCapturedSentryEvents();
    logLines = [];
    stream = new Writable({
      write(chunk, _encoding, done) {
        try {
          const parsed = JSON.parse(String(chunk));
          logLines.push(parsed);
        } catch (_err) {
          // ignore non-json
        }
        done();
      },
    });

    app = Fastify({
      logger: {
        ...securityLogger,
        stream,
      },
    });

    // Register trace context & server span extraction
    app.addHook(
      'onRequest',
      (
        req: FastifyRequest,
        _reply: FastifyReply,
        done: HookHandlerDoneFunction,
      ) => {
        const rawTrace = req.headers[TRACEPARENT_HEADER];
        const incomingTrace =
          typeof rawTrace === 'string'
            ? /00-([0-9a-f]{32})-([0-9a-f]{16})-01/.exec(rawTrace)
            : null;
        const traceId = incomingTrace ? incomingTrace[1]! : generateTraceId();
        const parentSpanId = incomingTrace ? incomingTrace[2]! : undefined;
        const rawReqId = req.headers[REQUEST_ID_HEADER];
        const requestId =
          typeof rawReqId === 'string' ? rawReqId : generateRequestId();

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

        const context = {
          traceId,
          spanId: span.spanId,
          requestId,
          parentSpanId,
        };

        (req as unknown as { traceContext: typeof context }).traceContext =
          context;
        (req as unknown as { serverSpan: typeof span }).serverSpan = span;

        runWithTraceContext(context, () => {
          done();
        });
      },
    );

    app.addHook(
      'onSend',
      (
        req: FastifyRequest,
        reply: FastifyReply,
        _payload: unknown,
        done: HookHandlerDoneFunction,
      ) => {
        const ctx = (
          req as unknown as {
            traceContext?: {
              traceId: string;
              spanId: string;
              requestId: string;
            };
          }
        ).traceContext;
        if (ctx) {
          reply.header(REQUEST_ID_HEADER, ctx.requestId);
          reply.header(
            TRACEPARENT_HEADER,
            formatTraceparent(ctx.traceId, ctx.spanId),
          );
        }
        done();
      },
    );

    app.addHook(
      'onResponse',
      (
        req: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction,
      ) => {
        const ctx = (
          req as unknown as {
            traceContext?: { traceId: string; spanId: string };
          }
        ).traceContext;
        const span = (
          req as unknown as {
            serverSpan?: { end: (status: 'ok' | 'error') => void };
          }
        ).serverSpan;
        if (span) {
          span.end(reply.statusCode < 500 ? 'ok' : 'error');
        }

        const duration_ms = Number(reply.elapsedTime.toFixed(2));
        const route = req.routeOptions.url ?? req.url.split('?')[0];
        req.log.info(
          {
            requestId: req.id,
            traceId: ctx?.traceId,
            spanId: ctx?.spanId,
            route,
            method: req.method,
            status: reply.statusCode,
            duration_ms,
          },
          'request completed',
        );
        done();
      },
    );

    registerErrorHandling(app);
  });

  it('produces one connected OTel trace covering browser request, Fastify handling, and Postgres query', async () => {
    // 1. Mock Postgres pool with telemetry instrumentation
    const fakePool = {
      query: vi.fn().mockImplementation((text: string) => {
        return Promise.resolve({
          rows: [
            {
              id: 'msg-1',
              conversation_id: 'conv-123',
              ciphertext: 'synthetic-ciphertext-not-logged',
              created_at: new Date(),
            },
          ],
          rowCount: 1,
        });
      }),
      connect: vi.fn(),
    } as unknown as Pool;

    instrumentPgPool(fakePool);

    // Mock journey route: Web -> Fastify -> Postgres
    app.get('/chat/messages', async (_req: FastifyRequest) => {
      // Simulate chat history loading:
      // 1. Membership check query
      await fakePool.query(
        'SELECT conversation_id, user_id FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
        ['conv-123', 'user-1'],
      );
      // 2. Fetch messages keyset query
      const result = await fakePool.query(
        'SELECT id, conversation_id, ciphertext, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2',
        ['conv-123', 50],
      );
      return { items: result.rows };
    });

    // 2. Simulate client browser initiating trace
    const clientTraceId = generateTraceId();
    const clientSpanId = generateSpanId();
    const clientRequestId = generateRequestId();
    const clientSpan = {
      traceId: clientTraceId,
      spanId: clientSpanId,
      name: 'web.fetch GET /chat/messages',
      kind: 'client' as const,
      startTimeMs: Date.now(),
      attributes: {
        'http.method': 'GET',
        'http.route': '/chat/messages',
      },
    };

    const traceparent = formatTraceparent(clientTraceId, clientSpanId);

    // 3. Send request with propagated trace headers
    const response = await app.inject({
      method: 'GET',
      url: '/chat/messages?conversationId=conv-123&limit=50',
      headers: {
        [TRACEPARENT_HEADER]: traceparent,
        [REQUEST_ID_HEADER]: clientRequestId,
      },
    });

    expect(response.statusCode).toBe(200);

    // Verify response propagated correlation headers
    expect(response.headers[REQUEST_ID_HEADER]).toBe(clientRequestId);
    expect(response.headers[TRACEPARENT_HEADER]).toMatch(
      new RegExp(`^00-${clientTraceId}-[0-9a-f]{16}-01$`),
    );

    // 4. Verify OTel Trace Graph Connectivity
    const traceSpans = getTraceSpans(clientTraceId);
    expect(traceSpans.length).toBeGreaterThanOrEqual(3);

    const serverSpan = traceSpans.find((s) => s.kind === 'server');
    expect(serverSpan).toBeDefined();
    expect(serverSpan?.traceId).toBe(clientTraceId);
    expect(serverSpan?.parentSpanId).toBe(clientSpanId); // child of browser request!
    expect(serverSpan?.name).toBe('http.server GET /chat/messages');
    expect(serverSpan?.duration_ms).toBeGreaterThanOrEqual(0);

    const dbMembershipSpan = traceSpans.find(
      (s) => s.kind === 'db' && s.name.includes('conversation_members'),
    );
    expect(dbMembershipSpan).toBeDefined();
    expect(dbMembershipSpan?.traceId).toBe(clientTraceId);
    expect(dbMembershipSpan?.parentSpanId).toBe(serverSpan?.spanId); // child of Fastify server span!
    expect(dbMembershipSpan?.duration_ms).toBeGreaterThanOrEqual(0);

    const dbMessagesSpan = traceSpans.find(
      (s) => s.kind === 'db' && s.name.includes('messages'),
    );
    expect(dbMessagesSpan).toBeDefined();
    expect(dbMessagesSpan?.traceId).toBe(clientTraceId);
    expect(dbMessagesSpan?.parentSpanId).toBe(serverSpan?.spanId); // child of Fastify server span!
    expect(dbMessagesSpan?.duration_ms).toBeGreaterThanOrEqual(0);

    // Verify operation names and that parameter values are NEVER included in span attributes
    for (const span of traceSpans) {
      expect(span.name).toBeDefined();
      expect(typeof span.duration_ms).toBe('number');
      const attrStr = JSON.stringify(span.attributes);
      expect(attrStr).not.toContain('conv-123');
      expect(attrStr).not.toContain('synthetic-ciphertext');
    }
  });

  it('uses structured pino logs with requestId, route, status, and duration_ms', async () => {
    app.get('/chat/messages', async () => ({ items: [] }));

    const reqId = 'req-structured-pino-test';
    const traceId = generateTraceId();
    const spanId = generateSpanId();

    const response = await app.inject({
      method: 'GET',
      url: '/chat/messages',
      headers: {
        [REQUEST_ID_HEADER]: reqId,
        [TRACEPARENT_HEADER]: formatTraceparent(traceId, spanId),
      },
    });

    expect(response.statusCode).toBe(200);

    // Verify structured log entry in output stream
    const completionLog = logLines.find(
      (l) => l['msg'] === 'request completed' && l['requestId'] === reqId,
    );
    expect(completionLog).toBeDefined();
    expect(completionLog?.['requestId']).toBe(reqId);
    expect(completionLog?.['traceId']).toBe(traceId);
    expect(completionLog?.['route']).toBe('/chat/messages');
    expect(completionLog?.['method']).toBe('GET');
    expect(completionLog?.['status']).toBe(200);
    expect(typeof completionLog?.['duration_ms']).toBe('number');
    expect(completionLog?.['duration_ms']).toBeGreaterThanOrEqual(0);
  });

  it('correlates one request across Sentry, Pino logs, and OTel trace using shared identifiers', async () => {
    app.get('/telemetry/deliberate-error', async () => {
      throw new AppError(
        'INTERNAL',
        'Deliberate failure for telemetry correlation',
      );
    });

    const sharedRequestId = 'req-correlation-shared-uuid-001';
    const sharedTraceId = generateTraceId();
    const clientSpanId = generateSpanId();

    const response = await app.inject({
      method: 'GET',
      url: '/telemetry/deliberate-error',
      headers: {
        [REQUEST_ID_HEADER]: sharedRequestId,
        [TRACEPARENT_HEADER]: formatTraceparent(sharedTraceId, clientSpanId),
      },
    });

    expect(response.statusCode).toBe(500);

    // 1. Check Pino Log
    const errorLog = logLines.find((l) => l['requestId'] === sharedRequestId);
    expect(errorLog).toBeDefined();
    expect(errorLog?.['requestId']).toBe(sharedRequestId);
    expect(errorLog?.['traceId']).toBe(sharedTraceId);
    expect(errorLog?.['status']).toBe(500);

    // 2. Check Sentry Event
    const sentryEvents = getCapturedSentryEvents();
    expect(sentryEvents.length).toBeGreaterThanOrEqual(1);
    const matchedSentryEvent = sentryEvents.find(
      (e) => e.tags?.requestId === sharedRequestId,
    );
    expect(matchedSentryEvent).toBeDefined();
    expect(matchedSentryEvent?.tags?.requestId).toBe(sharedRequestId);
    expect(matchedSentryEvent?.tags?.traceId).toBe(sharedTraceId);
    expect(matchedSentryEvent?.environment).toBeDefined();
    expect(matchedSentryEvent?.release).toBeDefined();

    // 3. Check OTel Trace Spans
    const traceSpans = getTraceSpans(sharedTraceId);
    expect(traceSpans.length).toBeGreaterThanOrEqual(1);
    const matchedSpan = traceSpans.find((s) => s.traceId === sharedTraceId);
    expect(matchedSpan).toBeDefined();
    expect(matchedSpan?.traceId).toBe(sharedTraceId);
    expect(matchedSpan?.parentSpanId).toBe(clientSpanId);

    // The single shared request is 100% correlated across Sentry, Logs, and Tracing!
    expect(errorLog?.['traceId']).toBe(matchedSentryEvent?.tags?.traceId);
    expect(errorLog?.['traceId']).toBe(matchedSpan?.traceId);
    expect(errorLog?.['requestId']).toBe(matchedSentryEvent?.tags?.requestId);
  });

  it('never sends private keys, passphrases, tokens, cookies, or message contents to telemetry', async () => {
    app.post('/auth/sensitive-operation', async (_req: FastifyRequest) => {
      throw new Error(
        `Database crash with privateKey: synthetic-pk, password: synthetic-pwd, ciphertext: synthetic-cipher`,
      );
    });

    const reqId = 'req-privacy-check-999';
    const traceId = generateTraceId();
    const spanId = generateSpanId();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/sensitive-operation',
      headers: {
        [REQUEST_ID_HEADER]: reqId,
        [TRACEPARENT_HEADER]: formatTraceparent(traceId, spanId),
        cookie: 'sessionId=secret-cookie-value',
        authorization: 'Bearer secret-bearer-token',
      },
      payload: {
        password: 'my-super-secret-password',
        privateKey: 'unwrapped-private-key-material',
        ciphertext: 'base64-encrypted-message-payload',
        nonce: 'encryption-nonce-value',
        text: 'plaintext message content',
      },
    });

    expect(response.statusCode).toBe(500);

    // 1. Inspect all serialized log lines
    const allLogText = JSON.stringify(logLines);
    expect(allLogText).not.toContain('my-super-secret-password');
    expect(allLogText).not.toContain('unwrapped-private-key-material');
    expect(allLogText).not.toContain('base64-encrypted-message-payload');
    expect(allLogText).not.toContain('encryption-nonce-value');
    expect(allLogText).not.toContain('plaintext message content');
    expect(allLogText).not.toContain('secret-cookie-value');
    expect(allLogText).not.toContain('secret-bearer-token');

    // 2. Inspect all Sentry events
    const allSentryText = JSON.stringify(getCapturedSentryEvents());
    expect(allSentryText).not.toContain('my-super-secret-password');
    expect(allSentryText).not.toContain('unwrapped-private-key-material');
    expect(allSentryText).not.toContain('base64-encrypted-message-payload');
    expect(allSentryText).not.toContain('encryption-nonce-value');
    expect(allSentryText).not.toContain('plaintext message content');
    expect(allSentryText).not.toContain('secret-cookie-value');
    expect(allSentryText).not.toContain('secret-bearer-token');

    // 3. Inspect all OTel trace spans
    const allSpansText = JSON.stringify(getAllRecordedSpans());
    expect(allSpansText).not.toContain('my-super-secret-password');
    expect(allSpansText).not.toContain('unwrapped-private-key-material');
    expect(allSpansText).not.toContain('base64-encrypted-message-payload');
    expect(allSpansText).not.toContain('encryption-nonce-value');
    expect(allSpansText).not.toContain('plaintext message content');
  });
});
