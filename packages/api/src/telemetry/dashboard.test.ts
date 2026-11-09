import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { clearTelemetryBuffers, registerTelemetryDashboard } from './dashboard';
import { clearRecordedSpans, getAllRecordedSpans } from './tracer';

const TOKEN = 'synthetic-telemetry-admin-token-123456';

describe('telemetry dashboard access control', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    clearRecordedSpans();
    app = Fastify();
    registerTelemetryDashboard(app, { adminToken: TOKEN });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    clearTelemetryBuffers();
  });

  it('rejects requests without the x-telemetry-token header', async () => {
    const routes = [
      ['GET', '/telemetry/dashboard'],
      ['GET', '/telemetry/api/data'],
      ['POST', '/telemetry/api/vitals'],
      ['POST', '/telemetry/api/clear'],
      ['POST', '/telemetry/api/spans'],
      ['POST', '/telemetry/api/test-error'],
    ] as const;
    const results = await Promise.all(
      routes.map(([method, url]) => app.inject({ method, url })),
    );
    results.forEach((res, i) => {
      expect(res.statusCode, `${routes[i]![0]} ${routes[i]![1]}`).toBe(401);
    });
  });

  it('rejects requests with a wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/telemetry/api/data',
      headers: { 'x-telemetry-token': 'wrong-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('serves data with the correct token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/telemetry/api/data',
      headers: { 'x-telemetry-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('spans');
  });

  it('ingests browser spans with the correct token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/telemetry/api/spans',
      headers: { 'x-telemetry-token': TOKEN },
      payload: {
        spans: [
          {
            traceId: 'a'.repeat(32),
            spanId: 'b'.repeat(16),
            name: 'web.fetch GET /chat',
            kind: 'client',
            startTimeMs: 1,
            endTimeMs: 2,
            duration_ms: 1,
            status: 'ok',
            attributes: {},
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ingested).toBe(1);
    expect(getAllRecordedSpans()).toHaveLength(1);
  });

  it('registers no routes when admin token is absent (safe default)', async () => {
    const bare = Fastify();
    registerTelemetryDashboard(bare, {});
    await bare.ready();
    const res = await bare.inject({
      method: 'GET',
      url: '/telemetry/api/data',
    });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });
});
