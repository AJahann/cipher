import { pathToFileURL } from 'node:url';

export async function waitForArtifact({
  getArtifacts,
  getBuild,
  name,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 120_000,
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const artifacts = await getArtifacts();
    if (
      artifacts.some((artifact) => artifact.name === name && !artifact.expired)
    ) {
      return;
    }
    const build = await getBuild();
    if (build?.status === 'completed' && build.conclusion !== 'success') {
      throw new Error(
        'Producer build failed; refusing to use an older artifact.',
      );
    }
    await sleep(2_000);
  }
  throw new Error('Timed out waiting for this run/attempt build artifact.');
}

async function main() {
  const {
    GITHUB_API_URL,
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT,
  } = process.env;
  const root = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  async function get(path) {
    const response = await fetch(`${root}${path}`, {
      headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`Artifact API returned ${response.status}`);
    return response.json();
  }
  await waitForArtifact({
    name: process.env.BUILD_ARTIFACT,
    getArtifacts: async () => (await get('/artifacts?per_page=100')).artifacts,
    getBuild: async () =>
      (
        await get(`/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100`)
      ).jobs.find((job) => job.name === 'Build'),
  });
  console.log('Exact run/attempt build artifact is available.');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
