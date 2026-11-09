export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: string;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'client' | 'server' | 'db' | 'internal';
  startTimeMs: number;
  endTimeMs: number;
  duration_ms: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  attributes: Record<string, unknown>;
}

export const TRACEPARENT_HEADER = 'traceparent';
export const REQUEST_ID_HEADER = 'x-request-id';

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

function getRandomHex(bytesCount: number): string {
  const bytes = new Uint8Array(bytesCount);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytesCount; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

export function generateTraceId(): string {
  return getRandomHex(16);
}

export function generateSpanId(): string {
  return getRandomHex(8);
}

export function generateRequestId(): string {
  return getRandomHex(16);
}

export function formatTraceparent(
  traceId: string,
  spanId: string,
  flags = '01',
): string {
  return `00-${traceId}-${spanId}-${flags}`;
}

export function parseTraceparent(header?: string | null): TraceContext | null {
  if (!header || typeof header !== 'string') return null;
  const match = TRACEPARENT_REGEX.exec(header.trim());
  if (!match) return null;
  const [, traceId, spanId, traceFlags] = match;
  // All-zero IDs are invalid per W3C specification
  if (!traceId || !spanId || !traceFlags) return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, traceFlags };
}

export function sanitizeRequestId(header?: string | null): string {
  if (!header || typeof header !== 'string') return generateRequestId();
  const trimmed = header.trim();
  if (/^[\w\-.]{1,128}$/.test(trimmed)) {
    return trimmed;
  }
  return generateRequestId();
}

const SENSITIVE_KEY_REGEX =
  /^(?:access[-_]?token|authorization|ciphertext|content|cookie|nonce|passphrase|password|private[-_]?key|secret|session|sessionid|sessionprivatekey|set[-_]?cookie|text|token|wrapped[-_]?(?:private|private[-_]?key))$/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_REGEX.test(key);
}

export function sanitizeTelemetryData<T>(input: T, seen = new WeakSet()): T {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    // Strip cookie and authorization token patterns
    let val: string = input;
    val = val.replace(/sessionid=\S+/gi, 'sessionId=[REDACTED]');
    val = val.replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]');
    // Strip inline secret words: privateKey: <value>, password: <value>, token <value>, password=<value>
    val = val.replace(
      /(access[-_]?token|ciphertext|content|nonce|passphrase|password|private[-_]?key|secret|token|wrapped[-_]?(?:private|private[-_]?key))(\s*[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;]+|\S+)/gi,
      (_match, key, sep) =>
        `${key}${sep.includes(':') ? ': ' : sep.includes('=') ? '=' : ' '}[REDACTED]`,
    );
    // Strip OAuth codes or tokens in query strings
    val = val.replace(
      /[&?](?:code|password|state|token)=[^\s&]*/gi,
      (m) => `${m.slice(0, m.indexOf('=') + 1)}[REDACTED]`,
    );
    return val as unknown as T;
  }

  if (typeof input !== 'object') return input;

  if (input instanceof Error) {
    const sanitizedError = new Error('[REDACTED_ERROR]');
    sanitizedError.name = input.name;
    sanitizedError.message = String(sanitizeTelemetryData(input.message, seen));
    return sanitizedError as unknown as T;
  }

  if (seen.has(input as object)) return '[CIRCULAR]' as unknown as T;
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map((item) =>
      sanitizeTelemetryData(item, seen),
    ) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeTelemetryData(value, seen);
    }
  }

  return result as unknown as T;
}
