import { pathToFileURL } from 'node:url';

export const requiredJobs = [
  'format',
  'lint',
  'typecheck',
  'build',
  'unit',
  'e2e',
];
export function acceptancePasses(needs) {
  if (needs.scope?.result !== 'success') return false;
  const expected =
    needs.scope.outputs?.docs_only === 'true' ? 'skipped' : 'success';
  return requiredJobs.every((job) => needs[job]?.result === expected);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!acceptancePasses(JSON.parse(process.env.CI_NEEDS))) {
    console.error('Required acceptance jobs did not complete as expected.');
    process.exitCode = 1;
  } else {
    console.log('Acceptance gate passed.');
  }
}
