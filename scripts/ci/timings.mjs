import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summarize(jobs) {
  return jobs
    .filter(
      (job) => job.status === 'completed' && job.started_at && job.completed_at,
    )
    .map((job) => ({
      name: job.name,
      conclusion: job.conclusion,
      seconds:
        job.conclusion === 'skipped'
          ? null
          : (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000,
      steps: (job.steps ?? [])
        .filter((step) => step.started_at && step.completed_at)
        .map((step) => ({
          name: step.name,
          conclusion: step.conclusion,
          seconds:
            (Date.parse(step.completed_at) - Date.parse(step.started_at)) /
            1000,
        })),
    }));
}

async function main() {
  const {
    GITHUB_API_URL,
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT,
  } = process.env;
  const jobs = [];
  for (let page = 1; ; page++) {
    const response = await fetch(
      `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=${page}`,
      {
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          accept: 'application/vnd.github+json',
        },
      },
    );
    if (!response.ok) throw new Error(`Jobs API returned ${response.status}`);
    const data = await response.json();
    jobs.push(...data.jobs);
    if (data.jobs.length < 100) break;
  }
  const completed = summarize(jobs);
  const report = {
    runId: GITHUB_RUN_ID,
    attempt: GITHUB_RUN_ATTEMPT,
    commit: process.env.GITHUB_SHA,
    event: process.env.GITHUB_EVENT_NAME,
    docsOnly: process.env.DOCS_ONLY === 'true',
    cacheEnabled: process.env.CACHE_ENABLED !== 'false',
    note: 'One run; integer-second API precision. Job times overlap, exclude queue delay, and must not be added as wall time. Gate job is still running and excluded.',
    jobs: completed,
  };
  writeFileSync('ci-timings.json', `${JSON.stringify(report, null, 2)}\n`);
  const table = completed
    .map(
      (job) =>
        `| ${job.name.replaceAll('|', '\\|')} | ${job.conclusion} | ${job.seconds ?? 'Not run'} |`,
    )
    .join('\n');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## CI timings\n\n${report.note}\n\n| Job | Result | Seconds |\n|---|---|---:|\n${table}\n`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
