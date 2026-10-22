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
