/* oxlint-disable complexity */
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

export interface InitWebSentryOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  transport?: (opts: any) => any;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  beforeSend?: (event: any, hint?: any) => any;
  forceReset?: boolean;
}

export function initWebSentry(options: InitWebSentryOptions = {}): void {
  if (webSentryInitialized && !options.forceReset) return;

  const environment =
    options.environment ??
    env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    // oxlint-disable-next-line node/no-process-env -- fallback for environments where env-nextjs client didn't supply it
    process.env.NODE_ENV ??
    'development';
  const release =
    options.release ?? env.NEXT_PUBLIC_SENTRY_RELEASE ?? 'cipher-web@0.1.0';
  const dsn = options.dsn ?? env.NEXT_PUBLIC_SENTRY_DSN;

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

  webSentryInitialized = true;
}

export function flushWebSentry(timeoutMs = 2000): Promise<boolean> {
  const client = Sentry.getClient();
  if (client) {
    return Sentry.flush(timeoutMs);
  }
  return Promise.resolve(true);
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
  const client = Sentry.getClient();
  const options = client?.getOptions();
  const environment =
    options?.environment ??
    env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    // oxlint-disable-next-line node/no-process-env -- fallback
    process.env.NODE_ENV ??
    'development';
  const release =
    options?.release ?? env.NEXT_PUBLIC_SENTRY_RELEASE ?? 'cipher-web@0.1.0';
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

export function getCapturedWebSentryEvents(): WebSentryEventRecord[] {
  return [...capturedWebEvents];
}

export function clearCapturedWebSentryEvents(): void {
  capturedWebEvents.length = 0;
}
