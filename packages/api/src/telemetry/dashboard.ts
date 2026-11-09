/* oxlint-disable max-lines-per-function */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  clearCapturedSentryEvents,
  getCapturedSentryEvents,
  captureApiError,
} from './sentry';
import {
  clearRecordedSpans,
  getAllRecordedSpans,
  ingestWebSpan,
  startSpan,
} from './tracer';
import { AppError } from '../http/errors';
import {
  formatTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  type SpanRecord,
} from '@chat-app/shared/telemetry';

export interface TelemetryLogRecord {
  requestId: string;
  traceId?: string;
  spanId?: string;
  route: string;
  method: string;
  status: number;
  duration_ms: number;
  timestamp: number;
}

export interface TelemetryVitalRecord {
  name: 'LCP' | 'INP' | 'CLS';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  route: string;
  timestamp: number;
  id: string;
  navigationType?: string;
}

const recentLogs: TelemetryLogRecord[] = [];
const recordedVitals: TelemetryVitalRecord[] = [];
const MAX_BUFFER = 100;

export function pushLogRecord(
  log: Omit<TelemetryLogRecord, 'timestamp'>,
): void {
  recentLogs.unshift({ ...log, timestamp: Date.now() });
  if (recentLogs.length > MAX_BUFFER) recentLogs.length = MAX_BUFFER;
}

export function pushVitalRecord(vital: TelemetryVitalRecord): void {
  recordedVitals.unshift(vital);
  if (recordedVitals.length > MAX_BUFFER) recordedVitals.length = MAX_BUFFER;
}

export function clearTelemetryBuffers(): void {
  recentLogs.length = 0;
  recordedVitals.length = 0;
  clearCapturedSentryEvents();
  clearRecordedSpans();
}

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cipher Telemetry & Sentry Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #090d16; color: #f1f5f9; padding: 24px; min-height: 100vh; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 16px; margin-bottom: 24px; }
    h1 { font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .badge-live { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
    .actions { display: flex; gap: 12px; align-items: center; }
    button { background: #1e293b; color: #f1f5f9; border: 1px solid #334155; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; transition: 0.15s; }
    button:hover { background: #334155; }
    button.btn-danger { background: #7f1d1d; border-color: #991b1b; }
    button.btn-danger:hover { background: #991b1b; }
    button.btn-primary { background: #2563eb; border-color: #3b82f6; }
    button.btn-primary:hover { background: #1d4ed8; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; }
    .stat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 6px; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .tabs { display: flex; gap: 8px; border-bottom: 1px solid #1e293b; margin-bottom: 20px; }
    .tab-btn { background: transparent; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 10px 16px; color: #94a3b8; font-size: 14px; }
    .tab-btn.active { color: #38bdf8; border-bottom-color: #38bdf8; font-weight: 600; }
    .panel { display: none; }
    .panel.active { display: block; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th { background: #0f172a; color: #94a3b8; padding: 10px 14px; border-bottom: 1px solid #1e293b; font-weight: 500; }
    td { padding: 12px 14px; border-bottom: 1px solid #1e293b; }
    tr:hover td { background: #0f172a; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .pill-green { background: #064e3b; color: #34d399; }
    .pill-red { background: #7f1d1d; color: #f87171; }
    .pill-yellow { background: #78350f; color: #fbbf24; }
    .code-id { font-family: monospace; font-size: 11px; color: #94a3b8; }
    .waterfall-bar { height: 14px; border-radius: 3px; background: #3b82f6; display: inline-block; }
    .waterfall-db { background: #f59e0b; }
    .waterfall-client { background: #10b981; }
    .tree-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #1e293b; font-size: 13px; }
    .tree-row.child { padding-left: 36px; background: #0b1120; }
    .tree-row.subchild { padding-left: 64px; background: #0d1527; }
    .vitals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .vital-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 20px; }
    .empty-state { text-align: center; padding: 48px; color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <header>
    <h1><span class="badge-live"></span> Cipher Telemetry & Sentry Panel</h1>
    <div class="actions">
      <label style="font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 6px; cursor: pointer;">
        <input type="checkbox" id="auto-refresh" checked> Auto-refresh (3s)
      </label>
      <button onclick="fetchData()">Refresh</button>
      <button class="btn-primary" onclick="triggerTestError()">Trigger Sentry Error</button>
      <button class="btn-danger" onclick="clearTelemetry()">Clear All</button>
    </div>
  </header>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Sentry Issues</div>
      <div class="stat-value" id="count-sentry" style="color: #f87171;">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">OTel Connected Traces</div>
      <div class="stat-value" id="count-traces" style="color: #38bdf8;">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Structured Pino Logs</div>
      <div class="stat-value" id="count-logs" style="color: #34d399;">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Web Vitals RUM</div>
      <div class="stat-value" id="count-vitals" style="color: #fbbf24;">0</div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" onclick="showTab('tab-sentry')">Sentry Errors</button>
    <button class="tab-btn" onclick="showTab('tab-traces')">OTel Spans & Waterfalls</button>
    <button class="tab-btn" onclick="showTab('tab-logs')">Structured Logs</button>
    <button class="tab-btn" onclick="showTab('tab-vitals')">Web Vitals RUM</button>
  </div>

  <!-- Sentry Panel -->
  <div id="tab-sentry" class="panel active">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Error / Message</th>
          <th>Environment / Release</th>
          <th>Route</th>
          <th>RequestId & TraceId</th>
        </tr>
      </thead>
      <tbody id="sentry-tbody">
        <tr><td colspan="5" class="empty-state">No Sentry errors recorded. Click "Trigger Sentry Error" above to generate a test capture.</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Traces Panel -->
  <div id="tab-traces" class="panel">
    <div id="traces-container">
      <div class="empty-state">No OTel traces recorded yet. Make a request to /chat/messages or trigger an action.</div>
    </div>
  </div>

  <!-- Structured Logs Panel -->
  <div id="tab-logs" class="panel">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Status</th>
          <th>Method & Route</th>
          <th>Duration</th>
          <th>Correlation (RequestId & TraceId)</th>
        </tr>
      </thead>
      <tbody id="logs-tbody">
        <tr><td colspan="5" class="empty-state">No logs captured in buffer yet.</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Web Vitals Panel -->
  <div id="tab-vitals" class="panel">
    <div class="vitals-grid" id="vitals-container">
      <div class="vital-card">
        <div class="stat-label">Largest Contentful Paint (LCP)</div>
        <div class="stat-value" id="lcp-val" style="font-size: 24px; color: #34d399;">—</div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 6px;">Good: ≤ 2.5s</p>
      </div>
      <div class="vital-card">
        <div class="stat-label">Interaction to Next Paint (INP)</div>
        <div class="stat-value" id="inp-val" style="font-size: 24px; color: #34d399;">—</div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 6px;">Good: ≤ 200ms</p>
      </div>
      <div class="vital-card">
        <div class="stat-label">Cumulative Layout Shift (CLS)</div>
        <div class="stat-value" id="cls-val" style="font-size: 24px; color: #34d399;">—</div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 6px;">Good: ≤ 0.1</p>
      </div>
    </div>
  </div>

  <script>
    const TELEMETRY_TOKEN = sessionStorage.getItem('telemetryToken') || '';
    if (!TELEMETRY_TOKEN) {
      const t = prompt('Enter telemetry admin token:');
      if (t) sessionStorage.setItem('telemetryToken', t);
      location.reload();
    }
    const telemetryHeaders = { 'x-telemetry-token': TELEMETRY_TOKEN };

    function showTab(id, btn) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const panel = document.getElementById(id);
      if (panel) panel.classList.add('active');
      const target = btn || (typeof event !== 'undefined' && event?.target) || document.querySelector('[onclick*="' + id + '"]');
      if (target?.classList) target.classList.add('active');
    }

    async function triggerTestError() {
      try {
        const res = await fetch('/telemetry/api/test-error', { method: 'POST', headers: telemetryHeaders });
        const json = await res.json();
        alert('Deliberate error triggered and captured in Sentry!\\nTrace ID: ' + json.traceId);
        fetchData();
      } catch (err) {
        alert('Failed triggering error: ' + err.message);
      }
    }

    async function clearTelemetry() {
      if (!confirm('Clear all captured telemetry data?')) return;
      await fetch('/telemetry/api/clear', { method: 'POST', headers: telemetryHeaders });
      fetchData();
    }

    async function fetchData() {
      try {
        const res = await fetch('/telemetry/api/data', { headers: telemetryHeaders });
        if (!res.ok) return;
        const data = await res.json();

        // Update counts
        document.getElementById('count-sentry').innerText = data.sentryEvents.length;
        document.getElementById('count-logs').innerText = data.logs.length;
        document.getElementById('count-vitals').innerText = data.vitals.length;

        // Group traces
        const traceMap = {};
        for (const s of data.spans) {
          if (!traceMap[s.traceId]) traceMap[s.traceId] = [];
          traceMap[s.traceId].push(s);
        }
        document.getElementById('count-traces').innerText = Object.keys(traceMap).length;

        // Render Sentry Table
        const sTbody = document.getElementById('sentry-tbody');
        if (data.sentryEvents.length === 0) {
          sTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No Sentry errors recorded.</td></tr>';
        } else {
          sTbody.innerHTML = data.sentryEvents.map(e => \`
            <tr>
              <td style="color: #94a3b8; font-size: 11px;">\${new Date(e.timestamp).toLocaleTimeString()}</td>
              <td><strong style="color: #f87171;">\${e.errorName || 'Error'}</strong>: \${e.message || 'Error occurred'}</td>
              <td><span class="pill pill-yellow">\${e.environment || 'dev'}</span> <span class="code-id">\${e.release || 'cipher@0.1.0'}</span></td>
              <td>\${e.tags?.route || '/'}</td>
              <td>
                <div class="code-id">req: \${e.tags?.requestId || 'n/a'}</div>
                <div class="code-id" style="color: #38bdf8;">trace: \${e.tags?.traceId || 'n/a'}</div>
              </td>
            </tr>
          \`).join('');
        }

        // Render Logs Table
        const lTbody = document.getElementById('logs-tbody');
        if (data.logs.length === 0) {
          lTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No logs captured yet.</td></tr>';
        } else {
          lTbody.innerHTML = data.logs.map(l => \`
            <tr>
              <td style="color: #94a3b8; font-size: 11px;">\${new Date(l.timestamp).toLocaleTimeString()}</td>
              <td><span class="pill \${l.status < 400 ? 'pill-green' : 'pill-red'}">\${l.status}</span></td>
              <td><strong>\${l.method}</strong> \${l.route}</td>
              <td style="color: #f1f5f9; font-weight: 600;">\${l.duration_ms} ms</td>
              <td>
                <div class="code-id">req: \${l.requestId}</div>
                <div class="code-id" style="color: #38bdf8;">trace: \${l.traceId || 'n/a'}</div>
              </td>
            </tr>
          \`).join('');
        }

        // Render Traces Waterfall
        const tContainer = document.getElementById('traces-container');
        const traceIds = Object.keys(traceMap);
        if (traceIds.length === 0) {
          tContainer.innerHTML = '<div class="empty-state">No OTel traces recorded yet.</div>';
        } else {
          tContainer.innerHTML = traceIds.map(tId => {
            const spans = traceMap[tId];
            const maxDuration = Math.max(...spans.map(s => s.duration_ms || 1), 1);
            return \`
              <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; margin-bottom: 16px; overflow: hidden;">
                <div style="padding: 12px 16px; background: #1e293b; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <span style="font-size: 12px; color: #94a3b8;">Trace: </span>
                    <strong style="color: #38bdf8; font-family: monospace;">\${tId}</strong>
                  </div>
                  <span style="font-size: 12px; color: #94a3b8;">\${spans.length} spans</span>
                </div>
                <div>
                  \${spans.map(s => {
                    const widthPct = Math.max(Math.min((s.duration_ms / maxDuration) * 100, 100), 5);
                    const kindClass = s.kind === 'client' ? 'waterfall-client' : (s.kind === 'db' ? 'waterfall-db' : 'waterfall-bar');
                    const depthClass = s.parentSpanId ? (s.kind === 'db' ? 'subchild' : 'child') : '';
                    return \`
                      <div class="tree-row \${depthClass}">
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span class="pill \${s.kind === 'client' ? 'pill-green' : (s.kind === 'db' ? 'pill-yellow' : 'pill-green')}">\${s.kind}</span>
                          <strong>\${s.name}</strong>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                          <span style="color: #94a3b8; font-size: 11px;">\${s.duration_ms} ms</span>
                          <div style="width: 140px; background: #090d16; border-radius: 3px; height: 14px;">
                            <div class="\${kindClass}" style="width: \${widthPct}%;"></div>
                          </div>
                        </div>
                      </div>
                    \`;
                  }).join('')}
                </div>
              </div>
            \`;
          }).join('');
        }

        // Render Vitals
        for (const v of data.vitals) {
          if (v.name === 'LCP') document.getElementById('lcp-val').innerText = v.value + ' ms';
          if (v.name === 'INP') document.getElementById('inp-val').innerText = v.value + ' ms';
          if (v.name === 'CLS') document.getElementById('cls-val').innerText = v.value;
        }
      } catch (err) {
        console.error('Fetch error:', err);
      }
    }

    fetchData();
    setInterval(() => {
      if (document.getElementById('auto-refresh').checked) fetchData();
    }, 3000);
  </script>
</body>
</html>`;
}

function requireTelemetryToken(
  req: FastifyRequest,
  reply: FastifyReply,
  token: string,
): boolean {
  const provided = req.headers['x-telemetry-token'];
  if (provided !== token) {
    void reply
      .code(401)
      .send({ code: 'UNAUTHORIZED', message: 'Invalid telemetry token' });
    return false;
  }
  return true;
}

export function registerTelemetryDashboard(
  app: FastifyInstance,
  opts: { adminToken?: string; ingestToken?: string },
): void {
  const { adminToken, ingestToken } = opts;
  if (!adminToken && !ingestToken) {
    // Telemetry routes disabled unless TELEMETRY_ADMIN_TOKEN or TELEMETRY_INGEST_TOKEN is configured.
    return;
  }

  const adminGuard = (req: FastifyRequest, reply: FastifyReply) => {
    if (!adminToken) {
      void reply
        .code(401)
        .send({ code: 'UNAUTHORIZED', message: 'Invalid telemetry token' });
      return false;
    }
    return requireTelemetryToken(req, reply, adminToken);
  };

  const ingestGuard = (req: FastifyRequest, reply: FastifyReply) => {
    const provided = req.headers['x-telemetry-token'];
    const matchesIngest = Boolean(ingestToken) && provided === ingestToken;
    const matchesAdmin = Boolean(adminToken) && provided === adminToken;
    if (!matchesIngest && !matchesAdmin) {
      void reply
        .code(401)
        .send({ code: 'UNAUTHORIZED', message: 'Invalid telemetry token' });
      return false;
    }
    return true;
  };

  // Public HTML Dashboard
  app.get('/telemetry/dashboard', (req, reply) => {
    if (!adminGuard(req, reply)) return;
    reply.type('text/html; charset=utf-8');
    return reply.send(getDashboardHtml());
  });

  // Data API for Dashboard
  app.get('/telemetry/api/data', (req, reply) => {
    if (!adminGuard(req, reply)) return;
    return reply.send({
      sentryEvents: getCapturedSentryEvents(),
      spans: getAllRecordedSpans(),
      logs: recentLogs,
      vitals: recordedVitals,
    });
  });

  // Client Web Vitals submission endpoint
  app.post('/telemetry/api/vitals', (req, reply) => {
    if (!ingestGuard(req, reply)) return;
    const vital = req.body as TelemetryVitalRecord;
    if (vital && vital.name && typeof vital.value === 'number') {
      pushVitalRecord(vital);
    }
    return reply.send({ ok: true });
  });

  // Clear buffers
  app.post('/telemetry/api/clear', (req, reply) => {
    if (!adminGuard(req, reply)) return;
    clearTelemetryBuffers();
    return reply.send({ ok: true });
  });

  // Browser span ingestion — connects web client spans with API spans by traceId.
  app.post('/telemetry/api/spans', (req, reply) => {
    if (!ingestGuard(req, reply)) return;
    const body = req.body as { spans?: unknown[] } | unknown[] | undefined;
    const spans = Array.isArray(body)
      ? body
      : Array.isArray(body?.spans)
        ? body.spans
        : [];
    let ingested = 0;
    for (const span of spans) {
      const s = span as Partial<SpanRecord>;
      if (
        s &&
        typeof s.traceId === 'string' &&
        typeof s.spanId === 'string' &&
        typeof s.name === 'string' &&
        typeof s.startTimeMs === 'number' &&
        typeof s.endTimeMs === 'number'
      ) {
        ingestWebSpan(s as SpanRecord);
        ingested += 1;
      }
    }
    return reply.send({ ok: true, ingested });
  });

  // Deliberate test error trigger
  app.post('/telemetry/api/test-error', (req, reply) => {
    if (!adminGuard(req, reply)) return;
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    const requestId = generateRequestId();

    const span = startSpan('http.server POST /telemetry/api/test-error', {
      kind: 'server',
      traceId,
      attributes: { 'http.route': '/telemetry/api/test-error' },
    });

    try {
      throw new AppError(
        'INTERNAL',
        'Deliberate test error triggered from Telemetry Panel',
      );
    } catch (error) {
      span.end('error', 'Deliberate test error');
      pushLogRecord({
        requestId,
        traceId,
        spanId,
        route: '/telemetry/api/test-error',
        method: 'POST',
        status: 500,
        duration_ms: span.end().duration_ms,
      });
      // Fastify error handler will also catch or we invoke captureApiError
      const eventId = captureApiError(error, {
        requestId,
        traceId,
        route: '/telemetry/api/test-error',
      });
      reply.header('x-request-id', requestId);
      reply.header('traceparent', formatTraceparent(traceId, spanId));
      return reply.code(500).send({
        code: 'INTERNAL',
        message: 'Deliberate test error triggered from Telemetry Panel',
        eventId,
        traceId,
        requestId,
      });
    }
  });
}
