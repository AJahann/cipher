import {
  formatTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  REQUEST_ID_HEADER,
  TRACEPARENT_HEADER,
  type SpanRecord,
} from '@chat-app/shared/telemetry';

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
      recordedWebSpans.push(record);
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
