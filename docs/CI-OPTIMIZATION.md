# CI optimization

## Baseline and acceptance policy

Implementation starts at `cac4949`. Its successful main push run, [39691552864](https://github.com/AJahann/cipher/actions/runs/39691552864), took about 90 seconds of overlapping job execution (not queue time). Individual steps: workspace build 13s, E2E web build 11s, browser setup 18s, PostgreSQL API tests 9s, Chromium tests 18s, unit coverage 13s, typecheck 5s, lint 1s. This is one observation, not a median or performance guarantee.

Integration branch: `ci/optimization`. Each phase lands through a separate PR. Preserve security assertions, real PostgreSQL acceptance, production builds, coverage, complete lint and Chromium tests. No paid services or new accounts are required.

## Phase 1: routing, measurement and Next cache

- A tested allowlist routes changes containing only `README.md` and Markdown under `docs/` through a lightweight gate. Unknown files, missing history, manual runs, mixed changes and tooling changes run full acceptance. Rename detection is disabled so moving runtime files into docs cannot hide their deletion.
- The existing six acceptance job names remain. Their deliberate job-level skips are permitted only after successful docs-only classification. `CI Gate` rejects failures, cancellation and unexpected skips. Branch protection can require this aggregate gate; existing named checks are not renamed or removed.
- The opt-in cache experiment persists only `apps/web/.next/cache`, not arbitrary full build outputs. Cache keys bind OS, architecture, lockfile, workflow/build configuration and source revision; compatible fallback entries seed compiler work, not acceptance verdicts. GitHub's PR cache isolation must be preserved. Never use `pull_request_target` to execute untrusted code with privileged cache access.
- `workflow_dispatch` always runs full acceptance. `next_cache` is disabled by default: toggle it on only for a warm-cache comparison. Compare several successful runs on the same commit/runner family, not isolated best cases. Report cold/warm/miss separately; record flakiness, queue time, job execution, relevant steps and artifact overhead.
- Every run records completed job/step timings in `ci-timings.json` and a job summary. Timestamps have integer-second API precision. Jobs overlap and must not be added as wall time. The currently running gate is excluded; timing telemetry is non-blocking, while acceptance remains blocking.

## Next phases and decision gates

1. Reuse a single web build only if artifact upload/download plus scheduling costs less than the duplicate build. E2E preparation must remain parallel to the producer build. Preserve hidden files, runtime manifests and build-time environment.
2. Separate PostgreSQL acceptance from browser acceptance, keeping fixtures serial within their existing shared schema.
3. Consolidate setup for static checks without hiding either result.
4. Benchmark browser container setup and Vitest project pools only if remaining timings justify it. Do not increase browser workers with shared mutable accounts, disable global isolation, reduce hashing costs or remove required assertions.
5. Defer native TypeScript, dependency-graph caching and fixture/shard redesign unless measured savings justify compatibility and maintenance costs. Vercel Remote Cache is optional, not a dependency; GitHub cache can support a later Turbo pilot.

## Results

Phase 1 PR #33 run [39763595968](https://github.com/AJahann/cipher/actions/runs/39763595968) passed all acceptance. E2E web compilation was 7s versus baseline 11s, but compiler cache restore/save consumed 8s + 7s; the Build job also spent 4s + 6s on its cache for a 12s build. **Do not enable Next caching by default** at this workload size; retain only an opt-in manual benchmark. This is not a controlled causal comparison: runners and cache state differ.

Browser installation was 77s versus the baseline 18s. E2E's job took 175s; the slower total is reported rather than hiding it behind the faster compilation step. Benchmark container setup before claiming any improvement. Routing and timestamp instrumentation remain independently useful.

Proposed research ranges are hypotheses, not acceptance claims.

## Phase 2: build reuse and independent database acceptance

- The Build job uploads a gzip archive of the exact web runtime, excluding compiler/dev caches. A local packaging pilot took 0.24s for a 4.26 MB archive; hosted transfer is measured separately, not inferred from local packing speed.
- E2E still prepares dependencies, its own PostgreSQL service and Chromium in parallel with Build. It waits only when consuming the artifact, avoiding a job-level dependency that would serialize all setup. The wait is bounded and fails on producer failure/expiry/wrong-attempt artifacts; it never falls back to an older commit. Archives are named by run ID and attempt, produced and consumed in the same workflow run. No external tokens are used.
- PostgreSQL API acceptance is a separate required job with its own database. Existing serial fixture execution is retained. Browser migrations still run against the browser job's separate database.
- `CI Gate` also requires PostgreSQL Tests for code changes. Node regression tests cover exact-artifact selection, expiry, producer failure and timeouts.
- Keep full build/runtime validation; no `ignoreBuildErrors`, hashing changes, auth mocks or test removal are involved.


The real docs-only smoke PR #35 ([run 39765662174](https://github.com/AJahann/cipher/actions/runs/39765662174)) passed Change Scope and CI Gate, with all six expensive jobs intentionally skipped. First job start to gate completion was 14s; queue time is excluded. GitHub reports inverted timestamps for some synthetic skipped jobs, so their duration is recorded as null/not run rather than a negative duration. The smoke PR is a disposable verification branch, not a feature merge.

To rerun build-artifact acceptance, choose **Re-run all jobs**, not only failed jobs: exact-attempt naming deliberately requires a producer in the same attempt. The handoff refuses an older attempt rather than silently accepting stale artifacts.


## Phase 3: browser environment and retain/defer decisions

- Piloted the public Microsoft Playwright `v1.63.0-noble` container instead of installing browser/OS dependencies every run. Pin its manifest digest and verify the installed `@playwright/test` version before acceptance. Dependency upgrades must update the image tag, digest and expected version together. Image pulling still costs time and is included in Initialize containers; it must not be hidden when comparing results.
- The container pilot passed all nine checks ([run 39766632624](https://github.com/AJahann/cipher/actions/runs/39766632624)); its E2E job took 117s versus 113s in the preceding host-run build-reuse run. These are different runners, not a controlled causal comparison. There is no demonstrated overall latency gain, so the container configuration was reverted before integration. Host-based browser installation, loopback PostgreSQL, one worker and all acceptance assertions remain the defaults. Image/version maintenance is not imposed without demonstrated value.
- A local shared-project pool pilot passed 24 tests in both modes: forks 3.01s, threads 3.36s (single non-coverage runs, not statistically conclusive). Keep the default pool: there is no demonstrated gain from changing it. Do not disable isolation or substitute DOM semantics.
- Keep all current coverage reports/gates and compiler checks. Their short baseline durations do not justify assurance or compatibility risk. Native TypeScript, Turbo/affected-package caching, test sharding and database fixture redesign remain deferred experiments, not claimed completed migrations.
- Keep Format and Lint named jobs for existing branch-protection compatibility. Consolidating them is deferred: their actual commands already take about a second, and a new reporting adapter would add complexity for runner-cost savings rather than shortening the E2E critical path.

Phase 2 PR #34 passed all nine hosted checks, including restoration/execution of the exact produced build and the independent PostgreSQL acceptance job. Workflow runtime varies with hosted startup and browser installation; do not infer a universal speedup from a single green run.


## Retained implementation and operational limits

- Retained: docs-only routing, the fail-closed aggregate gate, job/step timing evidence, one exact-run web build shared with E2E, and independent required PostgreSQL acceptance.
- Default-off or deferred: Next compiler cache (restore/save exceeded saved compilation), browser-image migration (no demonstrated overall gain), pool changes, Turbo/native TypeScript, sharding, reduced coverage and check-name consolidation. No paid service or new account was introduced.
- In the phase-2 hosted run [39765863552](https://github.com/AJahann/cipher/actions/runs/39765863552), artifact wait was within one-second timestamp resolution, download took 2s and restore was within one-second resolution. Build-side upload took 1s. This replaces the prior 13s duplicate web-build step without serializing preparation. Browser setup still varied substantially; these component observations are not a guaranteed end-to-end speedup.
- Protect `CI Gate` when configuring branch rules so the independent PostgreSQL check cannot be omitted. Existing Format/Lint/Typecheck/Build/Unit Tests/E2E check names are preserved; no branch protection settings were changed automatically.
- The only telemetry failure tolerated is timing collection availability. Actual build, tests, artifact handoff, classification tests and acceptance gate failures remain blocking.
