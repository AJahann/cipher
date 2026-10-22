import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// An allowlist, not an exclusion list: unknown files always get full acceptance.
export function isDocsOnly(paths) {
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        path === 'README.md' || /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(path),
    )
  );
}

export function changedPaths(event, eventName, runGit) {
  const base =
    eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  const head =
    eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after;
  if (!base || !head || /^0+$/.test(base)) return null;
  if (![base, head].every((sha) => /^[a-f\d]{40}$/.test(sha))) return null;
  // Disabling rename detection includes BOTH sides of moves across boundaries.
  return runGit(['diff', '--no-renames', '--name-only', '-z', base, head])
    .split('\0')
    .filter(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let docsOnly = false;
  try {
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'),
    );
    const paths = changedPaths(event, process.env.GITHUB_EVENT_NAME, (args) =>
      execFileSync('git', args, { encoding: 'utf8' }),
    );
    docsOnly = paths !== null && isDocsOnly(paths);
  } catch {
    // Missing history, malformed events and manual runs all fail closed.
    console.log('Scope could not be established; running full acceptance.');
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`);
  console.log(
    docsOnly ? 'Documentation-only change.' : 'Full acceptance required.',
  );
}
