import * as Sentry from '@sentry/node';
import { sanitizeTelemetryData } from '@chat-app/shared/telemetry';
import { env } from '../config/env';

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

export function initApiSentry(): void {
  if (sentryInitialized) return;

  const environment = env.SENTRY_ENVIRONMENT ?? env.NODE_ENV;
  const release = env.SENTRY_RELEASE ?? 'cipher-api@0.1.0';

  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
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
  const environment = env.SENTRY_ENVIRONMENT ?? env.NODE_ENV;
  const release = env.SENTRY_RELEASE ?? 'cipher-api@0.1.0';
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

  if (env.SENTRY_DSN) {
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
