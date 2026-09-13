import * as Sentry from '@sentry/browser';
import { sanitizeTelemetryData } from '@chat-app/shared/telemetry';
import { env } from '@/config/env';

export interface WebSentryEventRecord {
  eventId: string;
  message?: string;
  environment?: string;
  release?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  errorName?: string;
  timestamp: number;
}

const capturedWebEvents: WebSentryEventRecord[] = [];
let webSentryInitialized = false;

export function initWebSentry(): void {
  if (webSentryInitialized) return;

  const environment =
    env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    // oxlint-disable-next-line node/no-process-env -- fallback for environments where env-nextjs client didn't supply it
    process.env.NODE_ENV ??
    'development';
  const release = env.NEXT_PUBLIC_SENTRY_RELEASE ?? 'cipher-web@0.1.0';

  if (env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
      dsn: env.NEXT_PUBLIC_SENTRY_DSN,
      environment,
      release,
      beforeSend(event) {
        return sanitizeTelemetryData(event);
      },
    });
  }

  webSentryInitialized = true;
}

export function captureWebError(
  error: unknown,
  context: {
    requestId?: string;
    traceId?: string;
    route?: string;
    extra?: Record<string, unknown>;
  } = {},
): string {
  const environment =
    env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    // oxlint-disable-next-line node/no-process-env -- fallback
    process.env.NODE_ENV ??
    'development';
  const release = env.NEXT_PUBLIC_SENTRY_RELEASE ?? 'cipher-web@0.1.0';
  const eventId = `sentry-web-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const sanitizedContext = sanitizeTelemetryData(context);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const sanitizedMessage = sanitizeTelemetryData(errorMessage);

  const record: WebSentryEventRecord = {
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

  capturedWebEvents.push(record);

  if (env.NEXT_PUBLIC_SENTRY_DSN) {
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

export function getCapturedWebSentryEvents(): WebSentryEventRecord[] {
  return [...capturedWebEvents];
}

export function clearCapturedWebSentryEvents(): void {
  capturedWebEvents.length = 0;
}
