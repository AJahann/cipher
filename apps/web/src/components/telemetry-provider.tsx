'use client';

import { useEffect } from 'react';
import { initWebSentry } from '@/lib/telemetry/sentry';
import { initWebVitalsRum } from '@/lib/telemetry/web-vitals';

export function TelemetryProvider() {
  useEffect(() => {
    initWebSentry();
    initWebVitalsRum();
  }, []);

  return null;
}
