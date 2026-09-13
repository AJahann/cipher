import { describe, expect, it } from 'vitest';
import {
  formatTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  sanitizeRequestId,
  sanitizeTelemetryData,
} from './index';

describe('telemetry W3C traceparent', () => {
  it('generates valid 32-hex traceId and 16-hex spanId', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('formats and parses W3C traceparent headers', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    const formatted = formatTraceparent(traceId, spanId, '01');
    expect(formatted).toBe(`00-${traceId}-${spanId}-01`);

    const parsed = parseTraceparent(formatted);
    expect(parsed).toEqual({ traceId, spanId, traceFlags: '01' });
  });

  it('rejects malformed and all-zero traceparent values', () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent('invalid-traceparent')).toBeNull();
    expect(
      parseTraceparent(
        '00-00000000000000000000000000000000-0000000000000001-01',
      ),
    ).toBeNull();
    expect(
      parseTraceparent(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
      ),
    ).toBeNull();
  });

  it('sanitizes and validates request IDs', () => {
    const valid = 'req-1234_test.abc';
    expect(sanitizeRequestId(valid)).toBe(valid);

    const generated = sanitizeRequestId(
      'malformed request id with spaces & symbols!',
    );
    expect(generated).toMatch(/^[0-9a-f]{32}$/);
    expect(sanitizeRequestId(null)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('telemetry secret scrubbing', () => {
  it('redacts private keys, passphrases, tokens, cookies, and message contents', () => {
    const sensitivePayload = {
      user: 'alice',
      password: 'super-secret-password',
      passphrase: 'passphrase-data',
      privateKey: 'synthetic-private-key-material',
      wrappedPrivateKey: {
        ciphertext: 'wrapped-key-ciphertext',
        salt: 'kdf-salt',
        nonce: 'kdf-nonce',
      },
      sessionPrivateKey: 'in-memory-raw-bytes',
      token: 'bearer-token-123',
      cookie: 'sessionId=secret-session-id; other=val',
      authorization: 'Bearer secret-jwt-token',
      ciphertext: 'encrypted-message-ciphertext',
      nonce: 'encryption-nonce',
      text: 'hello secret world',
      metadata: {
        safeField: 'visible-metadata',
        nestedPass: {
          secret: 'deep-secret',
        },
      },
    };

    const sanitized = sanitizeTelemetryData(sensitivePayload);

    expect(sanitized.user).toBe('alice');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.passphrase).toBe('[REDACTED]');
    expect(sanitized.privateKey).toBe('[REDACTED]');
    expect(sanitized.wrappedPrivateKey).toBe('[REDACTED]');
    expect(sanitized.sessionPrivateKey).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.cookie).toBe('[REDACTED]');
    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.ciphertext).toBe('[REDACTED]');
    expect(sanitized.nonce).toBe('[REDACTED]');
    expect(sanitized.text).toBe('[REDACTED]');
    expect(sanitized.metadata.safeField).toBe('visible-metadata');
    expect(sanitized.metadata.nestedPass.secret).toBe('[REDACTED]');

    // Ensure raw strings never leak in serialized representation
    const json = JSON.stringify(sanitized);
    expect(json).not.toContain('super-secret-password');
    expect(json).not.toContain('synthetic-private-key-material');
    expect(json).not.toContain('wrapped-key-ciphertext');
    expect(json).not.toContain('bearer-token-123');
    expect(json).not.toContain('secret-session-id');
    expect(json).not.toContain('encrypted-message-ciphertext');
    expect(json).not.toContain('hello secret world');
  });

  it('redacts inline credentials in strings and error messages', () => {
    const errorString =
      'Failed fetch to /auth/callback?code=oauth-code-123&state=state-456 with cookie sessionId=abc123xyz and Bearer my-secret-jwt';
    const sanitized = sanitizeTelemetryData(errorString);

    expect(sanitized).not.toContain('oauth-code-123');
    expect(sanitized).not.toContain('state-456');
    expect(sanitized).not.toContain('abc123xyz');
    expect(sanitized).not.toContain('my-secret-jwt');
    expect(sanitized).toContain('sessionId=[REDACTED]');
    expect(sanitized).toContain('Bearer [REDACTED]');
    expect(sanitized).toContain('code=[REDACTED]');
    expect(sanitized).toContain('state=[REDACTED]');
  });
});
