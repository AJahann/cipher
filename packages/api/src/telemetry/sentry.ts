/* oxlint-disable complexity */
import * as Sentry from '@sentry/node';
import { sanitizeTelemetryData } from '@chat-app/shared/telemetry';

export interface SentryEventRecord {
  eventId: string;
  message?: string;
  environment?: string;
  release?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  errorName?: string;
  timestamp: number;
}

const capturedEvents: SentryEventRecord[] = [];
const MAX_CAPTURED_EVENTS = 500;

function pushEvent(record: SentryEventRecord): void {
  capturedEvents.push(record);
  if (capturedEvents.length > MAX_CAPTURED_EVENTS)
    capturedEvents.splice(0, capturedEvents.length - MAX_CAPTURED_EVENTS);
}

let sentryInitialized = false;

function getSentryConfig() {
  const environment =
    // oxlint-disable-next-line node/no-process-env
    process.env.SENTRY_ENVIRONMENT ??
    // oxlint-disable-next-line node/no-process-env
    process.env.NODE_ENV ??
    'development';
  // oxlint-disable-next-line node/no-process-env
  const release = process.env.SENTRY_RELEASE ?? 'cipher-api@0.1.0';
  // oxlint-disable-next-line node/no-process-env
  const dsn = process.env.SENTRY_DSN;
  return { environment, release, dsn };
}

export interface InitApiSentryOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  transport?: (opts: any) => any;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  beforeSend?: (event: any, hint?: any) => any;
  forceReset?: boolean;
}

export function initApiSentry(options: InitApiSentryOptions = {}): void {
  if (sentryInitialized && !options.forceReset) return;

  const envConfig = getSentryConfig();
  const environment = options.environment ?? envConfig.environment;
  const release = options.release ?? envConfig.release;
  const dsn = options.dsn ?? envConfig.dsn;

  if (dsn) {
    Sentry.init({
      dsn,
      environment,
      release,
      transport: options.transport,
      beforeSend(event, hint) {
        const sanitized = sanitizeTelemetryData(event);
        if (options.beforeSend) {
          return options.beforeSend(sanitized, hint);
        }
        return sanitized;
      },
    });
  }

  sentryInitialized = true;
}

export function flushApiSentry(timeoutMs = 2000): Promise<boolean> {
  const client = Sentry.getClient();
  if (client) {
    return Sentry.flush(timeoutMs);
  }
  return Promise.resolve(true);
}

export function captureApiError(
  error: unknown,
  context: {
    requestId?: string;
    traceId?: string;
    route?: string;
    extra?: Record<string, unknown>;
  } = {},
): string {
  const client = Sentry.getClient();
  const options = client?.getOptions();
  const environment =
    options?.environment ??
    // oxlint-disable-next-line node/no-process-env
    process.env.SENTRY_ENVIRONMENT ??
    // oxlint-disable-next-line node/no-process-env
    process.env.NODE_ENV ??
    'development';
  const release =
    options?.release ??
    // oxlint-disable-next-line node/no-process-env
    process.env.SENTRY_RELEASE ??
    'cipher-api@0.1.0';
  const eventId = `sentry-api-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const sanitizedContext = sanitizeTelemetryData(context);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const sanitizedMessage = sanitizeTelemetryData(errorMessage);

  const record: SentryEventRecord = {
    eventId,
    message: sanitizedMessage,
    errorName: error instanceof Error ? error.name : 'Error',
    environment,
    release,
    tags: {
      requestId: sanitizedContext.requestId ?? 'unknown',
      traceId: sanitizedContext.traceId ?? 'unknown',
      route: sanitizedContext.route ?? 'unknown',
    },
    extra: sanitizedContext.extra,
    timestamp: Date.now(),
  };

  pushEvent(record);

  if (client) {
    Sentry.withScope((scope) => {
      if (sanitizedContext.requestId)
        scope.setTag('requestId', sanitizedContext.requestId);
      if (sanitizedContext.traceId)
        scope.setTag('traceId', sanitizedContext.traceId);
      if (sanitizedContext.route) scope.setTag('route', sanitizedContext.route);
      if (sanitizedContext.extra) scope.setExtras(sanitizedContext.extra);
      Sentry.captureException(error);
    });
  }

  return eventId;
}

export function getCapturedSentryEvents(): SentryEventRecord[] {
  return [...capturedEvents];
}

export function clearCapturedSentryEvents(): void {
  capturedEvents.length = 0;
}
