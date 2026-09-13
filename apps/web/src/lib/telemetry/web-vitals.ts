import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';

export interface WebVitalMetric {
  name: 'LCP' | 'INP' | 'CLS';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  route: string;
  timestamp: number;
  id: string;
  navigationType?: string;
}

const recordedMetrics: WebVitalMetric[] = [];

export function getCleanRouteContext(): string {
  if (typeof window === 'undefined' || !window.location) return '/';
  const pathname = window.location.pathname || '/';
  // Strip any query strings, hashes, or potential private/dynamic identifiers
  const clean = pathname.split('?')[0]?.split('#')[0] || '/';
  return clean.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id',
  );
}

export function recordWebVitalMetric(
  metric: Pick<Metric, 'name' | 'value' | 'rating' | 'id'> & {
    navigationType?: string;
  },
  routeContext?: string,
): WebVitalMetric {
  const route = routeContext ?? getCleanRouteContext();
  const record: WebVitalMetric = {
    name: metric.name as 'LCP' | 'INP' | 'CLS',
    value: Number(metric.value.toFixed(2)),
    rating: metric.rating,
    route,
    timestamp: Date.now(),
    id: metric.id,
    navigationType: metric.navigationType,
  };

  recordedMetrics.push(record);
  return record;
}

export function getRecordedWebVitals(): WebVitalMetric[] {
  return [...recordedMetrics];
}

export function clearRecordedWebVitals(): void {
  recordedMetrics.length = 0;
}

let webVitalsInitialized = false;

export function reportVitalToApi(vital: WebVitalMetric): void {
  if (typeof window === 'undefined') return;
  try {
    const { origin } = window.location;
    void fetch(`${origin}/telemetry/api/vitals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vital),
      keepalive: true,
    }).catch(() => {});
  } catch (_err) {
    // ignore
  }
}

export function initWebVitalsRum(
  onReport?: (metric: WebVitalMetric) => void,
): void {
  if (typeof window === 'undefined' || webVitalsInitialized) return;
  webVitalsInitialized = true;

  const handleMetric = (metric: Metric) => {
    const record = recordWebVitalMetric(metric);
    reportVitalToApi(record);
    onReport?.(record);
  };

  try {
    onLCP(handleMetric);
    onINP(handleMetric);
    onCLS(handleMetric);
  } catch (_err) {
    // Gracefully handle environments without PerformanceObserver
  }
}
