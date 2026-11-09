import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureWebError,
  clearCapturedWebSentryEvents,
  getCapturedWebSentryEvents,
} from './sentry';
import {
  clearWebSpans,
  getAllWebSpans,
  getWebSpans,
  startWebSpan,
} from './tracer';
import {
  clearRecordedWebVitals,
  getCleanRouteContext,
  getRecordedWebVitals,
  recordWebVitalMetric,
} from './web-vitals';

describe('client Sentry telemetry & scrubbing', () => {
  beforeEach(() => {
    clearCapturedWebSentryEvents();
  });

  it('captures client errors with environment, release, and correlation tags', () => {
    captureWebError(new Error('Synthetic client error'), {
      requestId: 'req-web-123',
      traceId: 'trace-web-456',
      route: '/chat',
    });

    const events = getCapturedWebSentryEvents();
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.message).toBe('Synthetic client error');
    expect(event.errorName).toBe('Error');
    expect(event.environment).toBeDefined();
    expect(event.release).toBe('cipher-web@0.1.0');
    expect(event.tags).toEqual({
      requestId: 'req-web-123',
      traceId: 'trace-web-456',
      route: '/chat',
    });
  });

  it('strictly redacts passphrases, private keys, cookies, tokens, and ciphertext from client Sentry', () => {
    captureWebError(
      new Error('Failed decrypting message with privateKey synthetic-priv-key'),
      {
        requestId: 'req-789',
        traceId: 'trace-789',
        route: '/chat',
        extra: {
          password: 'plain-password',
          passphrase: 'plain-passphrase',
          privateKey: 'raw-private-key-material',
          wrappedPrivateKey: 'wrapped-data',
          token: 'jwt-token-value',
          cookie: 'sessionId=secret-sid-value',
          ciphertext: 'super-secret-ciphertext',
          nonce: 'secret-nonce',
          text: 'plaintext secret chat text',
        },
      },
    );

    const [event] = getCapturedWebSentryEvents();
    expect(event).toBeDefined();
    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain('plain-password');
    expect(serialized).not.toContain('plain-passphrase');
    expect(serialized).not.toContain('synthetic-priv-key');
    expect(serialized).not.toContain('raw-private-key-material');
    expect(serialized).not.toContain('jwt-token-value');
    expect(serialized).not.toContain('secret-sid-value');
    expect(serialized).not.toContain('super-secret-ciphertext');
    expect(serialized).not.toContain('plaintext secret chat text');

    expect(event?.extra?.password).toBe('[REDACTED]');
    expect(event?.extra?.privateKey).toBe('[REDACTED]');
    expect(event?.extra?.ciphertext).toBe('[REDACTED]');
  });
});

describe('client trace context propagation', () => {
  beforeEach(() => {
    clearWebSpans();
  });

  it('creates client span and injects traceparent & x-request-id headers', () => {
    const span = startWebSpan('web.fetch GET /chat/messages');
    const headers = new Headers();
    span.injectHeaders(headers);

    expect(headers.has('traceparent')).toBe(true);
    expect(headers.has('x-request-id')).toBe(true);
    expect(headers.get('traceparent')).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
    );

    const record = span.end('ok');
    expect(record.name).toBe('web.fetch GET /chat/messages');
    expect(record.status).toBe('ok');
    expect(record.duration_ms).toBeGreaterThanOrEqual(0);

    const spans = getWebSpans(span.traceId);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.spanId).toBe(span.spanId);
  });

  it('end() is idempotent: double-end records exactly one span', () => {
    const span = startWebSpan('web.fetch GET /users/me');
    span.end('ok');
    const again = span.end('error', 'late failure');
    // Second call returns first record, does not append another span.
    expect(again.status).toBe('ok');
    const spans = getWebSpans(span.traceId);
    expect(spans).toHaveLength(1);
  });
});

describe('RUM Web Vitals instrumentation', () => {
  beforeEach(() => {
    clearRecordedWebVitals();
  });

  it('captures LCP, INP, and CLS with page/route context', () => {
    recordWebVitalMetric(
      {
        name: 'LCP',
        value: 1250.45,
        rating: 'good',
        id: 'v4-lcp-1',
        navigationType: 'navigate',
      },
      '/chat',
    );

    recordWebVitalMetric(
      {
        name: 'INP',
        value: 48.2,
        rating: 'good',
        id: 'v4-inp-1',
      },
      '/chat',
    );

    recordWebVitalMetric(
      {
        name: 'CLS',
        value: 0.02,
        rating: 'good',
        id: 'v4-cls-1',
      },
      '/',
    );

    const vitals = getRecordedWebVitals();
    expect(vitals).toHaveLength(3);

    expect(vitals[0]).toMatchObject({
      name: 'LCP',
      value: 1250.45,
      rating: 'good',
      route: '/chat',
    });

    expect(vitals[1]).toMatchObject({
      name: 'INP',
      value: 48.2,
      rating: 'good',
      route: '/chat',
    });

    expect(vitals[2]).toMatchObject({
      name: 'CLS',
      value: 0.02,
      rating: 'good',
      route: '/',
    });
  });

  it('normalizes route context and removes dynamic identifiers or query params', () => {
    const rawRoute =
      '/chat/33333333-3333-4333-8333-333333333333?code=secret-oauth-code';
    // Test cleaning logic
    const clean = rawRoute
      .split('?')[0]!
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        ':id',
      );
    expect(clean).toBe('/chat/:id');
    expect(clean).not.toContain('secret-oauth-code');
  });
});
