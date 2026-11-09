import {
  formatTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  REQUEST_ID_HEADER,
  TRACEPARENT_HEADER,
  type SpanRecord,
} from '@chat-app/shared/telemetry';
import { env } from '../../config/env';
import { getApiOrigin } from '../data-layer/api-origin';

function exportSpanToApi(record: SpanRecord): void {
  const token = env.NEXT_PUBLIC_TELEMETRY_TOKEN;
  if (!token || typeof window === 'undefined') return;
  try {
    void fetch(`${getApiOrigin()}/telemetry/api/spans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telemetry-token': token,
      },
      body: JSON.stringify({ spans: [record] }),
      keepalive: true,
    }).catch(() => {});
  } catch (_err) {
    // ignore — telemetry export must never break the app
  }
}

export interface WebSpanHandle {
  traceId: string;
  spanId: string;
  requestId: string;
  parentSpanId?: string;
  name: string;
  kind: 'client';
  startTimeMs: number;
  startPerf: number;
  attributes: Record<string, unknown>;
  injectHeaders: (headers: Headers | Record<string, string>) => void;
  end: (status?: 'ok' | 'error', errorMessage?: string) => SpanRecord;
}

const recordedWebSpans: SpanRecord[] = [];
const MAX_WEB_SPANS = 500;

function pushBounded<T>(buffer: T[], item: T, max: number): void {
  buffer.push(item);
  if (buffer.length > max) buffer.splice(0, buffer.length - max);
}

export function startWebSpan(
  name: string,
  options: {
    traceId?: string;
    parentSpanId?: string;
    requestId?: string;
    attributes?: Record<string, unknown>;
  } = {},
): WebSpanHandle {
  const traceId = options.traceId ?? generateTraceId();
  const spanId = generateSpanId();
  const requestId = options.requestId ?? generateRequestId();
  const { parentSpanId } = options;
  const startTimeMs = Date.now();
  const startPerf = typeof performance !== 'undefined' ? performance.now() : 0;
  const attributes = { ...options.attributes };
  let ended = false;
  let lastRecord: SpanRecord | undefined;

  const handle: WebSpanHandle = {
    traceId,
    spanId,
    requestId,
    parentSpanId,
    name,
    kind: 'client',
    startTimeMs,
    startPerf,
    attributes,
    injectHeaders(headers: Headers | Record<string, string>) {
      const traceparent = formatTraceparent(traceId, spanId);
      if (headers instanceof Headers) {
        if (!headers.has(TRACEPARENT_HEADER))
          headers.set(TRACEPARENT_HEADER, traceparent);
        if (!headers.has(REQUEST_ID_HEADER))
          headers.set(REQUEST_ID_HEADER, requestId);
      } else {
        if (!headers[TRACEPARENT_HEADER])
          headers[TRACEPARENT_HEADER] = traceparent;
        if (!headers[REQUEST_ID_HEADER]) headers[REQUEST_ID_HEADER] = requestId;
      }
    },
    end(status: 'ok' | 'error' = 'ok', errorMessage?: string) {
      if (ended) return lastRecord!;
      ended = true;
      const endTimeMs = Date.now();
      const endPerf =
        typeof performance !== 'undefined' ? performance.now() : 0;
      const duration_ms = Number((endPerf - startPerf).toFixed(2));
      const record: SpanRecord = {
        traceId,
        spanId,
        parentSpanId,
        name,
        kind: 'client',
        startTimeMs,
        endTimeMs,
        duration_ms,
        status,
        errorMessage,
        attributes,
      };
      lastRecord = record;
      pushBounded(recordedWebSpans, record, MAX_WEB_SPANS);
      exportSpanToApi(record);
      return record;
    },
  };

  return handle;
}

export function getWebSpans(traceId: string): SpanRecord[] {
  return recordedWebSpans.filter((s) => s.traceId === traceId);
}

export function getAllWebSpans(): SpanRecord[] {
  return [...recordedWebSpans];
}

export function clearWebSpans(): void {
  recordedWebSpans.length = 0;
}
