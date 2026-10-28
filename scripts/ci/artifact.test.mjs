import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForArtifact } from './wait-artifact.mjs';

test('artifact wait rejects expired and differently named archives until exact attempt is ready', async () => {
  let time = 0,
    calls = 0;
  await waitForArtifact({
    name: 'web-build-42-2',
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    getArtifacts: async () =>
      ++calls === 1
        ? [
            { name: 'web-build-42-1', expired: false },
            { name: 'web-build-42-2', expired: true },
          ]
        : [{ name: 'web-build-42-2', expired: false }],
    getBuild: async () => ({ status: 'in_progress' }),
  });
  assert.equal(calls, 2);
});
test('artifact wait fails closed on producer failure or timeout', async () => {
  const common = { name: 'build', getArtifacts: async () => [] };
  await assert.rejects(
    waitForArtifact({
      ...common,
      getBuild: async () => ({ status: 'completed', conclusion: 'failure' }),
    }),
    /Producer build failed/,
  );
  let time = 0;
  await assert.rejects(
    waitForArtifact({
      ...common,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      timeoutMs: 1,
      getBuild: async () => ({ status: 'in_progress' }),
    }),
    /Timed out/,
  );
});

test('failed-job reruns fail promptly rather than accepting a prior-attempt artifact', async () => {
  let slept = false;
  await assert.rejects(
    waitForArtifact({
      name: 'web-build-42-2',
      attemptStartedAt: '2026-10-28T07:58:21Z',
      getArtifacts: async () => [{ name: 'web-build-42-1', expired: false }],
      // GitHub relabels carried-over jobs with the new attempt number.
      getBuild: async () => ({
        status: 'completed',
        conclusion: 'success',
        run_attempt: 2,
        completed_at: '2026-10-28T07:47:18Z',
      }),
      sleep: async () => {
        slept = true;
      },
    }),
    /Re-run all jobs/,
  );
  assert.equal(slept, false);
});

test('a current-attempt producer can finish while artifact visibility catches up', async () => {
  let time = 0,
    calls = 0;
  await waitForArtifact({
    name: 'web-build-42-2',
    attemptStartedAt: '2026-10-28T07:58:21Z',
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    getArtifacts: async () =>
      ++calls < 3 ? [] : [{ name: 'web-build-42-2', expired: false }],
    getBuild: async () =>
      calls === 1
        ? { status: 'in_progress' }
        : {
            status: 'completed',
            conclusion: 'success',
            completed_at: '2026-10-28T07:59:00Z',
          },
  });
  assert.equal(calls, 3);
});
