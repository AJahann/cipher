import { AsyncLocalStorage } from 'node:async_hooks';
import {
  generateSpanId,
  generateTraceId,
  type SpanRecord,
} from '@chat-app/shared/telemetry';

export interface ActiveTraceContext {
  traceId: string;
  spanId: string;
  requestId: string;
  parentSpanId?: string;
}

const traceStorage = new AsyncLocalStorage<ActiveTraceContext>();
const recordedSpans: SpanRecord[] = [];
const MAX_RECORDED_SPANS = 1000;

function pushSpan(record: SpanRecord): void {
  recordedSpans.push(record);
  if (recordedSpans.length > MAX_RECORDED_SPANS)
    recordedSpans.splice(0, recordedSpans.length - MAX_RECORDED_SPANS);
}

export function runWithTraceContext<T>(
  context: ActiveTraceContext,
  fn: () => T,
): T {
  return traceStorage.run(context, fn);
}

export function getTraceContext(): ActiveTraceContext | undefined {
  return traceStorage.getStore();
}

export interface SpanHandle {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'client' | 'server' | 'db' | 'internal';
  startTimeMs: number;
  startPerf: number;
  attributes: Record<string, unknown>;
  end: (status?: 'ok' | 'error', errorMessage?: string) => SpanRecord;
}

export function startSpan(
  name: string,
  options: {
    kind?: 'client' | 'server' | 'db' | 'internal';
    parentSpanId?: string;
    traceId?: string;
    attributes?: Record<string, unknown>;
  } = {},
): SpanHandle {
  const currentContext = getTraceContext();
  const traceId =
    options.traceId ?? currentContext?.traceId ?? generateTraceId();
  const parentSpanId = options.parentSpanId ?? currentContext?.spanId;
  const spanId = generateSpanId();
  const startTimeMs = Date.now();
  const startPerf = performance.now();
  const kind = options.kind ?? 'internal';
  const attributes = { ...options.attributes };
  let ended = false;
  let lastRecord: SpanRecord | undefined;

  const handle: SpanHandle = {
    traceId,
    spanId,
    parentSpanId,
    name,
    kind,
    startTimeMs,
    startPerf,
    attributes,
    end(status: 'ok' | 'error' = 'ok', errorMessage?: string) {
      if (ended) return lastRecord!;
      ended = true;
      const endTimeMs = Date.now();
      const duration_ms = Number((performance.now() - startPerf).toFixed(2));
      const record: SpanRecord = {
        traceId,
        spanId,
        parentSpanId,
        name,
        kind,
        startTimeMs,
        endTimeMs,
        duration_ms,
        status,
        errorMessage,
        attributes,
      };
      lastRecord = record;
      pushSpan(record);
      return record;
    },
  };

  return handle;
}

export function getTraceSpans(traceId: string): SpanRecord[] {
  return recordedSpans.filter((s) => s.traceId === traceId);
}

export function getAllRecordedSpans(): SpanRecord[] {
  return [...recordedSpans];
}

/**
 * Record a browser-side span exported from the web client so a single trace
 * covers browser request → Fastify handling → Postgres query.
 */
export function ingestWebSpan(record: SpanRecord): void {
  if (!record || typeof record.traceId !== 'string') return;
  pushSpan(record);
}

export function clearRecordedSpans(): void {
  recordedSpans.length = 0;
}
