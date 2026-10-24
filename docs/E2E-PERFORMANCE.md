# E2E performance improvement report

## Scope and acceptance

Integration branch: `e2e/performance`. Each phase is implemented on a child
branch, tested, then merged into the integration branch. The final PR targets
`main` for human review; it must not auto-merge.

Preserve all required acceptance jobs, security assertions, real KDF/key
operations, UI registration/login/unlock coverage, screenshots on failure and
first-retry traces. No paid services or credentials are required. A custom image
may contain public dependencies only. Never publish application data, auth
states or secrets.

Measure at least three successful, comparable hosted runs per phase. Use the
whole E2E job median and observed range, not the sum of parallel job durations.
The Playwright command includes API/web startup and setup, not just assertions.
Report failures and retries separately; three runs are screening evidence, not
statistical significance. Cache misses and first-time image pulls are real costs.

## Retained baseline

Source commit: `feb58c51aef134d18751a033ed9a91c94e80d953`.
All three completed full CI runs succeeded; two manual dispatches and one main
push. Cache inputs, retry counts and per-test durations are not established by
public job timestamps, so do not infer a controlled cold/warm comparison.

| Run | E2E job | Containers | Playwright command | Post Node cache step |
| --- | ---: | ---: | ---: | ---: |
| [39791227119](https://github.com/AJahann/cipher/actions/runs/39791227119) | 133 s | 49 s | 23 s | 34 s |
| [39826084181](https://github.com/AJahann/cipher/actions/runs/39826084181) | 96 s | 46 s | 22 s | 0 s |
| [40135724420](https://github.com/AJahann/cipher/actions/runs/40135724420) | 91 s | 36 s | 23 s | 0 s |

Whole-job median **96 s**, observed range **91–133 s**. Playwright command
median **23 s**, range **22–23 s**. Container initialization includes PostgreSQL
startup: it is not an isolated browser-image pull measurement.

## Implementation order

| Phase | Change | Status / decision |
| --- | --- | --- |
| 1 | Restore-only E2E dependency caching; one Build cache writer | Retained: three successful trials; cache ownership is deterministic |
| 2 | Record video only on first retry | Retained: three successful trials; diagnostic policy verified |
| 3 | Pinned Chromium-only public GHCR image | Retained: three successful trials; anonymous image access and cache hits verified |
| 4 | API provisioning using production key generation/KDF | Retained: three full green runs, median 77 s (76–81 s), one CI worker |
| 5 | Benchmark two workers after worker-scoped provisioning | In progress: bounded two-worker trial after isolated foundation |

### Phase 1: single cache writer

All dependency consumers restore an exact lockfile/OS/architecture/Node-major
store key. Only Build saves via `actions/cache`; all other jobs use
`actions/cache/restore`, with no post-job save. This removes E2E cache-write work
and redundant writers without caching `node_modules`. The new explicit key
namespace has an initial cold population cost, which must not be hidden.

GitHub's cache scope applies unchanged: a fork PR may populate only its PR-scoped
cache; no privileged workflow restores an untrusted PR cache into a trusted
publish job. No broad restore prefixes are used. Failed installs cannot save a
partial cache because the writer's normal post-save requires job success.

No median speedup is claimed before trials. The baseline's 34-second cache tail
occurred in only one run; the other two already spent zero seconds there.

## Operational limits

- Keep required `CI Gate`; never skip security tests to reduce duration.
- Exact-run artifacts require rerunning all jobs, not failed jobs only.
- Cache storage and GHCR availability are external dependencies; installs must
  work on cache misses, and image upgrades require matching Playwright versions.
- Do not enable workers against the existing shared Alice/Bob sessions.
- Never commit `playwright/.auth`, cookies, wrapped private keys or trace data.

### Phase 1 measured decision

Trials: [105 s](https://github.com/AJahann/cipher/actions/runs/40137110848),
[87 s](https://github.com/AJahann/cipher/actions/runs/40137297269),
[93 s](https://github.com/AJahann/cipher/actions/runs/40137451625).
All nine checks succeeded in each run. Median **93 s**, range **87–105 s**,
versus baseline **96 s**, range **91–133 s**. The 3-second median difference is
not convincing causal speed evidence with this sample and startup variance.
Retain for removal of E2E save work and single-writer ownership; the E2E
post-restore step was zero seconds in all three trials. No new failure observed
in hosted acceptance; retry counts are not available from public timestamps.

### Phase 2 diagnostic tradeoff

Video now records only on first retry, matching the existing trace policy.
Failure screenshots remain enabled. A failure on the initial attempt has a
screenshot but no video; a first retry records video even if that retry passes.
This is the explicitly accepted diagnostic tradeoff, not removal of assertions.

### Local validation caveats

- CI helper tests, formatting, typecheck and 141 non-database unit tests passed.
- Initial local PostgreSQL attempt used the wrong port (connection refused).
  Corrected disposable-server port, then all 74 API tests passed serially.
- Local Chromium uses a sandbox-installed executable, not the pinned CI browser;
  local timings must not be compared with hosted job durations.

### Phase 2 measured decision

Three successful full CI trials: **84, 90, 84 s**; median **84 s**, range
**84–90 s**. Playwright command median **17 s**, versus phase 1's **20 s**.
Container medians also changed, so do not attribute the entire nine-second
whole-job difference to video. Retain the lower recording workload with the
explicitly approved diagnostic tradeoff. Local full suite passed 14/14; a separate
intentional-failure test verified screenshot/no-initial-video/retry-video+trace.

### Phase 3 image candidate

Final CA-correct image published and smoke-tested in [40139123937](https://github.com/AJahann/cipher/actions/runs/40139123937).
Anonymous access succeeded both in the publisher and via an independent registry
manifest request. Normal PR CI receives no GHCR credentials.

Pinned candidate digest:
`sha256:87dc299f5fb469371950d93c0336f9e4f3ac6e955809fa627f9c797332b01c4f`.

Linux amd64 compressed manifest layer sizes: **384,085,775 bytes** candidate
versus **955,790,767 bytes** previous MCR image (**59.8% smaller**). This measures
registry layer bytes, not unpacked disk size or expected time savings. Debian
Bookworm replaces Ubuntu inside the container; hosted validation must prove
runtime compatibility. Host runners remain Ubuntu 24.04.

The image includes exact Node/pnpm versions and Chromium headless shell only.
E2E removes redundant toolchain installers, verifies installed versions and keeps
the Playwright package/image parity guard. Headed browsers, custom channels,
Firefox and WebKit are not supported by this image. See
`.github/e2e-image/README.md` for rebuild, anonymous-access and rollback gates.

## Cumulative timing evidence (screening only)

| Cohort | Runs | E2E median | Observed range | Playwright median | Acceptance span median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 3 | 96 s | 91–133 s | 23 s | 114 s |
| 1 · Restore-only cache | 3 | 93 s | 87–105 s | 20 s | 111 s |
| 2 · Retry-only video | 3 | 84 s | 84–90 s | 17 s | 104 s |
| 3 · Slim Chromium image | 3 | 79 s | 75–80 s | 20 s | 96 s |

Acceptance span is first job start through last required job completion; it
includes internal scheduling and gate time, but not the initial workflow queue.

### Cache-path correction discovered during image review

The original Phase 1 cache path came from each job's HOME. GitHub cache versions
include paths, so host Build and container E2E paths could not share a populated
store despite matching key text. Phase 1 therefore proved removal of E2E writes,
not effective cross-environment cache hits. Corrected before the retained image
trials: all jobs explicitly use `/tmp/cipher-pnpm-store` via pnpm's environment
configuration, and cache that same absolute path. The first corrected-key version
may be cold. No cache-hit percentage is inferred from timing alone.

Image hardening before the retained cohort: install and smoke-test `git` and
`zstd`. The latter avoids a second host/container cache-version mismatch from
different compression availability. Candidate builds and pre-hardening CI runs
are development checks, not silently mixed into the final image cohort.

### Pre-cohort infrastructure failure (not hidden)

[40138874577](https://github.com/AJahann/cipher/actions/runs/40138874577)
failed E2E Checkout before any application test: Git reported `server certificate
verification failed. CAfile: none`. Installing Git without recommended packages
in a slim Debian image omitted OS CA certificates. Added explicit
`ca-certificates` and a publisher smoke test that performs verified HTTPS
`git ls-remote` against this public repository before publication. TLS verification
remains enabled. This failed run is excluded from successful timing statistics
but retained in the failure ledger; the final corrected image needs a fresh
three-run cohort.

### Phase 3 measured decision

Final corrected cohort: **80, 75, 79 s**, median **79 s**, range **75–80 s**.
All nine checks passed in each. Three exact dependency-store hits were explicitly
reported; restore costs (5–8 s) are included. Container median was 30 s versus
phase 2's 42 s, while the Playwright command median rose from 17 to 20 s. Thus
image/startup work improved the whole job without proving faster browser tests.
Retain the smaller pinned image and preinstalled toolchain; continue monitoring
registry/cache overhead and patch the image through the documented upgrade gate.

### Phase 4 fixture foundation (one worker)

Provisioning and account isolation are deliberately implemented together, then
benchmarked at **one** CI worker before changing concurrency. A worker gets
unique Alice/Bob accounts and a private, atomic temporary directory beneath
`playwright/.auth`, outside uploaded reports. Restarted workers and simultaneous
runs cannot reuse global files. Contexts, request clients, private-key buffers and
auth files are cleaned up in `finally` paths.

Provisioning calls the real register API with production X25519 keys and the
production Argon2id wrapping implementation (opslimit 2, memory 64 MiB). It checks
201, authenticated identity, key-bundle equality and session cookies. No fake
keys, database inserts, reduced password hashing or globally unlocked pages.
Every authenticated browser still performs the real UI unlock.

UI registration remains in the Charlie draft-isolation test; independent UI
login/logout and unlock/wrong-passphrase tests remain. Charlie now also uses a
random unique username. Application tests remain **13**; the former **14** total
included a setup-only test that is replaced by the worker fixture, not removed
application coverage. CI now fails on flaky retries rather than silently accepting
a retry pass. Local worker-path tests cover simultaneous runs, projects,
restarted workers, traversal-safe names and directory permissions.

Local laboratory validation: typecheck and path unit test passed; 13 application
E2E tests passed with one worker, and 39 executions passed with two workers across
three repetitions. These local durations are not hosted speed evidence. Local
Oxlint's JavaScript plugin bridge still hits its previously observed allocator
panic; do not weaken lint configuration. Hosted full lint remains required.

### Local accessibility flake found and fixed before hosted fixture trials

The stricter flaky-test policy exposed one initial-attempt contrast failure on
the login error-state scan; its retry passed, but the run correctly failed.
The submit button becomes enabled while its `disabled:opacity-50` to full-opacity
transition is still running (`transition-all duration-150`). Axe sampled that
intermediate, low-contrast frame. The test now asserts the real submit button is
enabled and has computed opacity 1 before scanning the stable error state. No
axe rules, states or violations are excluded; no fixed sleeps or axe retries.

### Hosted fixture pre-cohort failures (not hidden)

[40140392138](https://github.com/AJahann/cipher/actions/runs/40140392138)
caught two integration issues before the retained fixture cohort:

- React 19's lint rule interpreted Playwright's callback parameter named `use`
  as the React hook. Renamed fixture callbacks to `fixtureUse`, not disabled lint.
- A CommonJS worker importing the root ESM environment module failed collection
  under the exact repository config. The external local harness had masked that
  loader boundary. Reproduced with the repository's own `--list`, removed the
  worker import, and passed validated URLs explicitly from Playwright config
  metadata and `use.baseURL`. The production environment schema stays intact.

The two missing-CA development runs were
[40138874577](https://github.com/AJahann/cipher/actions/runs/40138874577) and
[40139127816](https://github.com/AJahann/cipher/actions/runs/40139127816); both
failed verified HTTPS checkout before tests, and were corrected before the
retained image cohort. None of these failures count as successful timings.

### Phase 5 bounded parallelism trial

Only worker count changes from one to two. Keep real key derivation, per-worker accounts, all application tests and fail-on-flaky acceptance. Compare three full hosted runs with phase 4; keep one worker if no worthwhile benefit or stability regresses. Never infer a linear 2× speedup.

### Two-worker pre-cohort flake

Run [40142184439](https://github.com/AJahann/cipher/actions/runs/40142184439) correctly failed on a flaky accessibility assertion (12 passed, 1 flaky). The conversation scan could observe the intentionally dimmed optimistic `sending` bubble before server acknowledgement. The ready-state test now asserts delivery is `sent` and bubble opacity is 1 before the unchanged axe scan. No axe exclusions, fixed sleep or reduced assertions. Earlier green two-worker development runs 40141846737 (65 s) and 40142019523 (61 s) are not mixed into the corrected cohort. Start three fresh full trials.
