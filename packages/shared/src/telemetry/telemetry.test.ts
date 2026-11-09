/* oxlint-disable eslint/max-lines-per-function */
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

  it('redacts review-flagged misses: accessToken, snake_case keys, set-cookie, inline secrets in errors', () => {
    const payload = {
      accessToken: 'oauth-access-token-xyz',
      wrapped_private_key: 'wrapped-snake-case-key',
      'set-cookie': 'sessionId=snake-cookie-value; HttpOnly',
      nested: { access_token: 'nested-access-token' },
    };
    const sanitized = sanitizeTelemetryData(payload);
    expect(sanitized.accessToken).toBe('[REDACTED]');
    expect(sanitized.wrapped_private_key).toBe('[REDACTED]');
    expect(sanitized['set-cookie']).toBe('[REDACTED]');
    expect(sanitized.nested.access_token).toBe('[REDACTED]');

    const json = JSON.stringify(sanitized);
    expect(json).not.toContain('oauth-access-token-xyz');
    expect(json).not.toContain('wrapped-snake-case-key');
    expect(json).not.toContain('snake-cookie-value');
    expect(json).not.toContain('nested-access-token');

    // Inline secrets inside free-text error messages
    const dbError = new Error(
      'insert failed: duplicate key value violates unique constraint on privateKey raw-private-key-material and ciphertext msg-ciphertext-body',
    );
    const sanitizedError = sanitizeTelemetryData(dbError) as Error;
    expect(sanitizedError.message).not.toContain('raw-private-key-material');
    expect(sanitizedError.message).not.toContain('msg-ciphertext-body');
    expect(sanitizedError.message).toContain('privateKey [REDACTED]');
    expect(sanitizedError.message).toContain('ciphertext [REDACTED]');
  });

  it('redacts colon-labelled and equals-labelled inline secrets in strings', () => {
    const probes = [
      'Error occurred at privateKey: secret-key-value-1234',
      'Payload contained ciphertext: encrypted-payload-9999',
      'Auth failure for password: my-super-secret-password',
      'Header had accessToken: oauth-token-value-5678',
      'Compact format privateKey:secret-key-compact',
      'Assignment format password=my-assigned-password',
      'Snake case format private_key: snake-secret-value',
      'Double-quote wrapped password: "wrapped-password-secret"',
    ];

    for (const probe of probes) {
      const sanitized = sanitizeTelemetryData(probe);
      expect(sanitized).not.toContain('secret-key-value-1234');
      expect(sanitized).not.toContain('encrypted-payload-9999');
      expect(sanitized).not.toContain('my-super-secret-password');
      expect(sanitized).not.toContain('oauth-token-value-5678');
      expect(sanitized).not.toContain('secret-key-compact');
      expect(sanitized).not.toContain('my-assigned-password');
      expect(sanitized).not.toContain('snake-secret-value');
      expect(sanitized).not.toContain('wrapped-password-secret');
      expect(sanitized).toContain('[REDACTED]');
    }
  });

  it('redacts complete multi-word secrets, PEM keys, and Cookie headers', () => {
    expect(sanitizeTelemetryData('content: alpha beta gamma')).toBe(
      'content: [REDACTED]',
    );
    expect(sanitizeTelemetryData('passphrase: alpha beta gamma')).toBe(
      'passphrase: [REDACTED]',
    );
    expect(sanitizeTelemetryData('Cookie: session=alpha; theme=beta')).toBe(
      'Cookie: [REDACTED]',
    );
    expect(
      sanitizeTelemetryData(
        'Set-Cookie: sessionId=secret-val; Path=/; HttpOnly',
      ),
    ).toBe('Set-Cookie: [REDACTED]');
    expect(
      sanitizeTelemetryData('privateKey: -----BEGIN PRIVATE KEY----- abc123'),
    ).toBe('privateKey: [REDACTED]');
    expect(
      sanitizeTelemetryData(
        'user: alice, passphrase: alpha beta gamma, ip: 127.0.0.1',
      ),
    ).toBe('user: alice, passphrase: [REDACTED], ip: 127.0.0.1');
  });
});
