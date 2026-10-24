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
| 2 | Record video only on first retry | Implemented; hosted trials pending; first-attempt video intentionally unavailable |
| 3 | Pinned Chromium-only public GHCR image | Pending; publish/anonymous-pull verification required before use |
| 4 | API provisioning using production key generation/KDF | Pending; keep explicit UI auth coverage |
| 5 | Worker-specific accounts and auth files; trial two workers | Pending; isolate before concurrency |

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
