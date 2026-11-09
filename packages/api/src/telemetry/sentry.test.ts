import { beforeEach, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/node';
import {
  captureApiError,
  flushApiSentry,
  initApiSentry,
  clearCapturedSentryEvents,
} from './sentry';

describe('Sentry SDK transport delivery & verification', () => {
  beforeEach(() => {
    clearCapturedSentryEvents();
  });

  it('delivers sanitized event envelope through Sentry SDK transport', async () => {
    const deliveredEnvelopes: { body: string | Uint8Array }[] = [];

    const mockTransport = (opts: any) =>
      Sentry.createTransport(opts, (req) => {
        deliveredEnvelopes.push(req);
        return Promise.resolve({ statusCode: 200 });
      });

    initApiSentry({
      dsn: 'https://12345678901234567890123456789012@o1.ingest.sentry.io/1',
      environment: 'staging',
      release: 'cipher-api@0.2.0-test',
      transport: mockTransport,
      forceReset: true,
    });

    const error = new Error(
      'Database auth error for password: my-raw-secret-password and privateKey: raw-secret-key-bytes',
    );

    captureApiError(error, {
      requestId: 'req-sdk-delivery-42',
      traceId: 'trace-sdk-delivery-42',
      route: '/auth/login',
      extra: {
        token: 'secret-bearer-token-12345',
        safeMetadata: 'safe-public-field',
      },
    });

    await flushApiSentry(2000);

    // 1. Proven delivery: SDK transport was actually called with envelopes
    expect(deliveredEnvelopes.length).toBeGreaterThan(0);

    const envelopeBodies = deliveredEnvelopes
      .map((e) => String(e.body))
      .join('\n');

    // 2. Verified tags, environment and release in delivered SDK envelope
    expect(envelopeBodies).toContain('req-sdk-delivery-42');
    expect(envelopeBodies).toContain('trace-sdk-delivery-42');
    expect(envelopeBodies).toContain('/auth/login');
    expect(envelopeBodies).toContain('cipher-api@0.2.0-test');
    expect(envelopeBodies).toContain('staging');
    expect(envelopeBodies).toContain('safe-public-field');

    // 3. Verified scrubbing: secrets never delivered to transport
    expect(envelopeBodies).not.toContain('my-raw-secret-password');
    expect(envelopeBodies).not.toContain('raw-secret-key-bytes');
    expect(envelopeBodies).not.toContain('secret-bearer-token-12345');
    expect(envelopeBodies).toContain('[REDACTED]');
  });
});
