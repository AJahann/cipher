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

export function initApiSentry(): void {
  if (sentryInitialized) return;

  const { environment, release, dsn } = getSentryConfig();

  if (dsn) {
    Sentry.init({
      dsn,
      environment,
      release,
      beforeSend(event) {
        return sanitizeTelemetryData(event);
      },
    });
  }

  sentryInitialized = true;
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
  const { environment, release, dsn } = getSentryConfig();
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

  capturedEvents.push(record);

  if (dsn) {
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
