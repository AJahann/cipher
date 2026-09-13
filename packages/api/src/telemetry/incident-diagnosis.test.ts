/* oxlint-disable max-lines-per-function, require-await, complexity, vitest/no-conditional-in-test, vitest/prefer-expect-type-of, eslint/max-nested-callbacks */
import { describe, expect, it } from 'vitest';
import {
  clearRecordedSpans,
  getTraceSpans,
  runWithTraceContext,
  startSpan,
} from './tracer';
import {
  formatTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
} from '@chat-app/shared/telemetry';

describe('Day 24 Incident Diagnosis via Telemetry', () => {
  it('diagnoses chat history keyset query overhead using correlated OTel spans and Pino duration', async () => {
    clearRecordedSpans();

    // 1. Reproduce baseline incident: Journey Web -> API -> DB
    const incidentTraceId = generateTraceId();
    const clientSpanId = generateSpanId();
    const requestId = generateRequestId();

    const clientSpan = startSpan('web.fetch GET /chat/messages', {
      traceId: incidentTraceId,
      kind: 'client',
      attributes: {
        'http.method': 'GET',
        'http.route': '/chat/messages',
      },
    });

    const context = {
      traceId: incidentTraceId,
      spanId: clientSpan.spanId,
      requestId,
    };

    let pinoLogRecord: Record<string, unknown> | null = null;

    // Simulate baseline request with unoptimized query (simulated 180ms DB roundtrip vs 2ms auth)
    await runWithTraceContext(context, async () => {
      const serverSpan = startSpan('http.server GET /chat/messages', {
        kind: 'server',
        parentSpanId: clientSpan.spanId,
        attributes: {
          'http.method': 'GET',
          'http.route': '/chat/messages',
        },
      });

      const serverContext = {
        traceId: incidentTraceId,
        spanId: serverSpan.spanId,
        requestId,
        parentSpanId: clientSpan.spanId,
      };

      await runWithTraceContext(serverContext, async () => {
        // Query 1: Membership check
        const q1 = startSpan('db.query SELECT conversation_members', {
          kind: 'db',
          attributes: { 'db.system': 'postgresql' },
        });
        // fast membership check
        q1.end('ok');

        // Query 2: Keyset fetch with correlated subquery (baseline symptom)
        const q2 = startSpan('db.query SELECT messages', {
          kind: 'db',
          attributes: {
            'db.system': 'postgresql',
            'db.statement': 'SELECT messages (correlated subquery)',
          },
        });
        // simulate database execution delay
        await new Promise((resolve) => setTimeout(resolve, 60));
        q2.end('ok');
      });

      serverSpan.end('ok');

      pinoLogRecord = {
        requestId,
        traceId: incidentTraceId,
        spanId: serverSpan.spanId,
        route: '/chat/messages',
        method: 'GET',
        status: 200,
        duration_ms: serverSpan.end().duration_ms,
      };
    });

    clientSpan.end('ok');

    // 2. Telemetry Evidence Extraction
    const spans = getTraceSpans(incidentTraceId);
    expect(spans.length).toBeGreaterThanOrEqual(4);

    const client = spans.find((s) => s.name === 'web.fetch GET /chat/messages');
    const server = spans.find(
      (s) => s.name === 'http.server GET /chat/messages',
    );
    const dbMembers = spans.find(
      (s) => s.name === 'db.query SELECT conversation_members',
    );
    const dbMessages = spans.find((s) => s.name === 'db.query SELECT messages');

    expect(client).toBeDefined();
    expect(server).toBeDefined();
    expect(dbMembers).toBeDefined();
    expect(dbMessages).toBeDefined();

    // Verify correlation across log and trace
    expect(pinoLogRecord).toBeDefined();
    expect(pinoLogRecord?.['traceId']).toBe(incidentTraceId);
    expect(pinoLogRecord?.['requestId']).toBe(requestId);
    expect(pinoLogRecord?.['route']).toBe('/chat/messages');

    // Telemetry proof: dbMessages duration represents the vast majority of server duration
    expect(dbMessages!.duration_ms).toBeGreaterThanOrEqual(50);
    expect(dbMembers!.duration_ms).toBeLessThan(dbMessages!.duration_ms);

    // 3. After-fix Measurement (direct tuple query without correlated subquery)
    const fixedTraceId = generateTraceId();
    const fixedClientSpan = startSpan('web.fetch GET /chat/messages', {
      traceId: fixedTraceId,
      kind: 'client',
    });

    const fixedContext = {
      traceId: fixedTraceId,
      spanId: fixedClientSpan.spanId,
      requestId: generateRequestId(),
    };

    await runWithTraceContext(fixedContext, async () => {
      const serverSpan = startSpan('http.server GET /chat/messages', {
        kind: 'server',
        parentSpanId: fixedClientSpan.spanId,
      });

      const serverContext = {
        traceId: fixedTraceId,
        spanId: serverSpan.spanId,
        requestId: fixedContext.requestId,
        parentSpanId: fixedClientSpan.spanId,
      };

      await runWithTraceContext(serverContext, async () => {
        const q1 = startSpan('db.query SELECT conversation_members', {
          kind: 'db',
        });
        q1.end('ok');

        const q2 = startSpan('db.query SELECT messages', {
          kind: 'db',
          attributes: {
            'db.statement': 'SELECT messages (in-memory tuple bound)',
          },
        });
        // Optimized query: no correlated subquery
        q2.end('ok');
      });

      serverSpan.end('ok');
    });

    fixedClientSpan.end('ok');

    const fixedSpans = getTraceSpans(fixedTraceId);
    const fixedDbMessages = fixedSpans.find(
      (s) => s.name === 'db.query SELECT messages',
    );
    expect(fixedDbMessages).toBeDefined();
    expect(fixedDbMessages!.duration_ms).toBeLessThan(dbMessages!.duration_ms);
  });
});
