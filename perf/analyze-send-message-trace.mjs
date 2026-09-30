import fs from 'node:fs/promises';

const tracePaths = process.argv.slice(2);
if (tracePaths.length === 0) {
  throw new Error(
    'Usage: node perf/analyze-send-message-trace.mjs <trace.json> [...]',
  );
}

const eventNames = [
  'EventDispatch',
  'FunctionCall',
  'UpdateLayoutTree',
  'Layout',
  'PrePaint',
  'Paint',
  'Commit',
  'FireAnimationFrame',
  'UpdateLayer',
  'Layerize',
];

function clippedDuration(event, start, end) {
  const eventStart = event.ts;
  const eventEnd = eventStart + (event.dur ?? 0);
  return Math.max(0, Math.min(eventEnd, end) - Math.max(eventStart, start));
}

for (const tracePath of tracePaths) {
  const trace = JSON.parse(await fs.readFile(tracePath, 'utf8'));
  const events = trace.traceEvents;
  const marks = Object.fromEntries(
    events
      .filter((event) =>
        ['cipher:send-start', 'cipher:pending-painted'].includes(event.name),
      )
      .map((event) => [event.name, event]),
  );
  const start = marks['cipher:send-start'];
  const end = marks['cipher:pending-painted'];
  if (!start || !end)
    throw new Error(`Missing milestone marks in ${tracePath}`);

  const mainThread = [start.pid, start.tid];
  const inWindow = events.filter(
    (event) =>
      event.ph === 'X' &&
      event.pid === mainThread[0] &&
      event.tid === mainThread[1] &&
      clippedDuration(event, start.ts, end.ts) > 0,
  );

  const breakdown = Object.fromEntries(
    eventNames.map((name) => {
      const matches = inWindow.filter((event) => event.name === name);
      const durations = matches.map(
        (event) => clippedDuration(event, start.ts, end.ts) / 1000,
      );
      return [
        name,
        {
          count: matches.length,
          totalMs: durations.reduce((sum, value) => sum + value, 0),
          maxMs: Math.max(0, ...durations),
        },
      ];
    }),
  );

  const longestEvents = inWindow
    .filter(
      (event) =>
        !['RunTask', 'ThreadControllerImpl::RunTask'].includes(event.name),
    )
    .map((event) => ({
      name: event.name,
      durationMs: clippedDuration(event, start.ts, end.ts) / 1000,
      type: event.args?.data?.type ?? null,
      functionName: event.args?.data?.functionName ?? null,
      url: event.args?.data?.url ?? null,
      lineNumber: event.args?.data?.lineNumber ?? null,
      columnNumber: event.args?.data?.columnNumber ?? null,
    }))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);

  console.log(
    JSON.stringify(
      {
        tracePath,
        windowMs: (end.ts - start.ts) / 1000,
        hasLongTaskOver50Ms: inWindow.some(
          (event) =>
            event.name === 'RunTask' &&
            clippedDuration(event, start.ts, end.ts) >= 50_000,
        ),
        hasNamedScrollEvent: inWindow.some((event) =>
          event.name.toLowerCase().includes('scroll'),
        ),
        breakdown,
        longestEvents,
      },
      null,
      2,
    ),
  );
}
