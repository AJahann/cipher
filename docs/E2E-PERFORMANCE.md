# E2E performance improvement report

## Outcome

Retain all five phases on `e2e/performance`, including **two isolated Chromium
workers**. Final PR targets `main` for human review; do not auto-merge.

- Hosted E2E median: **96 → 72 seconds**
  (24 seconds / 25% lower observed median).
- Observed range: **91–133 → 63–83 seconds**.
- Playwright-command median: **23 → 13 seconds**.
  This includes API/web startup, provisioning and tests, not only assertions.
- Full acceptance span median: **114 → 87 seconds**.
  First job start to last required job completion, excluding initial queue.

These small sequential samples do **not** guarantee a speedup on every run.
Container startup, cache/registry state and runner variability materially affect
whole-job times. Do not attribute the entire improvement to one tool or parallelism.

## Hosted measurements

| Cohort | Runs | E2E median | Observed range | Playwright median | Acceptance span median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 3 | 96 s | 91–133 s | 23 s | 114 s |
| 1 · Restore-only cache | 3 | 93 s | 87–105 s | 20 s | 111 s |
| 2 · Retry-only video | 3 | 84 s | 84–90 s | 17 s | 104 s |
| 3 · Slim image + cache parity | 3 | 79 s | 75–80 s | 20 s | 96 s |
| 4 · Isolated API fixtures (1 worker) | 3 | 77 s | 76–81 s | 17 s | 92 s |
| 5 · Two isolated workers | 3 | 72 s | 63–83 s | 13 s | 87 s |

Each cohort contains three full successful hosted runs. Non-Markdown source trees
are identical within each cohort (fingerprints verified). Original baseline commit
is `feb58c51aef134d18751a033ed9a91c94e80d953`; baseline mixes push/manual runs,
whereas phase trials use PRs. This is not a randomized or statistically significant
experiment. Timestamps have one-second precision. Public job durations do not
establish per-test retry counts, warm/cold image state or a controlled cache comparison.

[Machine-readable evidence](e2e-performance-results.json) contains every accepted
run URL, SHA, source-tree fingerprint, job/step timing, cache observation and summary.
UTC timestamp arithmetic and medians were independently checked. Failures are
reported separately below, never treated as successful fast runs.

## Implementation decisions, easy to hard

### 1. Restore-only consumers, one cache writer — retained

Build is the sole pnpm-store cache writer. Other consumers, including E2E, restore
only, using an exact lockfile/OS/architecture/Node-major key. No broad restore
prefixes or cached `node_modules`. The small timing change alone is weak evidence;
retain deterministic ownership and removal of E2E post-save work.

**Correction during phase 3:** initial paths resolved from job-specific HOME values.
Host Build and container E2E therefore had different cache versions despite equal
key text. Phase 1 proved ownership, **not shared cache hits**. All jobs now use
`/tmp/cipher-pnpm-store` through `pnpm_config_store_dir`, validate the resolved pnpm
path, and use compatible compression tooling (`zstd`).

The corrected image, one-worker fixture and final two-worker cohorts each observed
three exact store hits. Earlier unknown hit states are unknown, not misses. Restore
cost is included; cache hits are not assumed cheaper than network installation.
PR cache scope stays under GitHub rules; no privileged publisher restores PR caches.

### 2. Retry-only video — retained with diagnostic tradeoff

Passing attempts no longer encode video. Failure screenshots remain; trace and video
record on first retry. An initial failure has **no initial-attempt video**. A local
intentional-failure check verified initial screenshot, no initial video, and retry
video plus trace. No assertions or required security tests were removed.

### 3. Pinned dependency-only Chromium image — retained

Digest: `sha256:87dc299f5fb469371950d93c0336f9e4f3ac6e955809fa627f9c797332b01c4f`.
See [maintenance, upgrade and rollback](../.github/e2e-image/README.md).

The image pins Node 24.11.1, pnpm 12.6.0 and Playwright 1.63.0, installing only
Chromium headless shell. Its isolated Docker context excludes application source,
auth states and secrets. Anonymous public pulls were verified in the publisher and
by an independent registry request. PR jobs receive no GHCR credentials.

Linux amd64 compressed manifest layers: **384,085,775 bytes** versus
previous MCR image **955,790,767 bytes** (**59.8% smaller**).
This is registry layer size, not unpacked size or an expected download time. The
container uses Debian Bookworm; the host runner remains Ubuntu 24.04.

Publisher triggers are trusted pushes to approved image paths/branches, never PRs.
Only its publishing job has package-write permission; checkout does not persist
credentials. Smoke checks verify exact versions, browser launch and verified HTTPS
Git before publication. Git, zstd and OS CA certificates are explicit dependencies;
TLS verification stays enabled. Package/image parity remains a required CI guard.

Upgrade package/image versions together, rebuild, smoke-test, verify anonymous access,
then pin the new digest. This image does not support headed/custom-channel runs or
Firefox/WebKit; those local projects remain available with normal browser installs.
Phase 3 combines image/toolchain changes **and cache parity correction**: it is not
an isolated image-size experiment. Its Playwright median rose while total time fell.

### 4. Real API provisioning plus worker isolation — retained

Provision Alice/Bob through the real register API with production X25519 keys and
Argon2id wrapping (opslimit 2, memory 64 MiB), verifying identity, key bundle and
session cookie. No fake keys, direct DB inserts, reduced hashing or global unlock.
Authenticated browser contexts still perform the real passphrase UI unlock.

Workers get unique random accounts and atomic private directories beneath
`playwright/.auth`, outside uploaded reports. Directories are 0700 and auth files
0600. Project/run/worker-restart paths cannot collide. Finally blocks dispose
requests/contexts, wipe private-key buffers and delete auth files. CI's disposable
PostgreSQL is discarded at job end; this does not purge rows in persistent local DBs.

All **13 application tests** remain. Previous total 14 included a setup-only test
replaced by provisioning, not removed application coverage. UI registration,
independent UI login/logout, unlock/wrong-passphrase, encrypted messaging, RTL and
all accessibility state assertions remain. Logout does not revoke worker fixture
sessions. CI now **fails on flaky retries**, even when a retry passes.
PostgreSQL API tests stay serial with a separate database service.

### 5. Two bounded workers — retained after corrected trials

Final corrected E2E trials: **83, 72, 63 seconds**, median **72**,
versus one-worker median **77**. Playwright-command median
fell **17 → 13 seconds**.
All nine jobs passed each corrected run; the final local stress run also passed
39 executions without retries. Retain two as a bounded
improvement, not linear scaling. Whole-job ranges overlap; startup variance remains.

A ready-state accessibility assertion was also corrected after the optimistic-message
flake below, so this is not a perfectly isolated worker-count experiment. Earlier
green development runs 40141846737 (65 s) and 40142019523 (61 s) are not pooled with
the corrected cohort. CLI `--workers=1` is the immediate concurrency rollback;
retain isolated provisioning even if reducing workers.

Do not raise workers or shard blindly. Extra workers provision more accounts and
run memory-hard crypto, competing for CPU/memory and API limits. Shards duplicate
setup and runner costs. Require another measured stability/budget gate beyond two.

## Failure and correction ledger

| Run / check | Failure | Correction / disposition |
| --- | --- | --- |
| [40138874577](https://github.com/AJahann/cipher/actions/runs/40138874577), [40139127816](https://github.com/AJahann/cipher/actions/runs/40139127816) | Missing CA certificates broke checkout before tests | Install CA bundle; publisher verifies HTTPS Git; never disable TLS |
| [40140392138](https://github.com/AJahann/cipher/actions/runs/40140392138) | React hook lint on callback `use`; CJS worker import of root ESM env failed collection | Rename callback `fixtureUse`; pass validated URLs through config metadata/use; verify exact root config |
| [40140662448](https://github.com/AJahann/cipher/actions/runs/40140662448) | Two destructuring lint errors; E2E passed | Destructure URLs without weakening lint or behavior |
| [40142184439](https://github.com/AJahann/cipher/actions/runs/40142184439) | Conversation scan: 12 passed, 1 flaky; CI correctly rejected retry pass | Assert delivered `sent` state and opacity 1 before unchanged ready-state axe scan; restart cohort |
| Local login-error accessibility scan | Enabled submit button was still transitioning from disabled opacity | Assert enabled and computed opacity 1 before unchanged scan |

The ready-state conversation scan raced the intentionally dimmed optimistic
`sending` bubble. Synchronizing on acknowledgement does **not** prove that transient
sending-state contrast meets accessibility requirements; that remains a separate
product-accessibility question. No axe exclusions, arbitrary sleeps, scan retries
or severity reductions were introduced.

Four superseded development runs were cancelled: 40138788924, 40138728313,
40138307314, 40138293289. Provisional image successes, including 40138568542 (69 s),
are excluded because runtime source/image differs, not because timing was inconvenient.
Corrected cohorts retain all completed accepted replicates with the same source.

## Validation and operational limits

- CI helper tests: **12 passed**. Unit suite: **142 passed,
  34 DB-conditional skips**. Explicit serial API run:
  **74 passed** (overlaps unit coverage; do not sum).
- Final local Chromium stress: **39/39 without retries**;
  targeted delivered-state scan: **5 repeats passed**.
  Local system Chromium/custom harness timings are not hosted speed evidence.
- Local Oxlint's JS plugin bridge has a known allocator panic; it was not bypassed
  or claimed green. Hosted full lint passed in every retained final trial.
- The initial local harness masked the ESM/CJS loader boundary. Exact repository
  collection and hosted acceptance now validate the actual configuration.
- Required jobs stay Change Scope, Format, Lint, Typecheck, Build, Unit Tests,
  PostgreSQL Tests, E2E Tests and CI Gate. Keep CI Gate required.
- Existing exact-run build reuse remains. **Rerun all jobs**, not failed jobs only:
  artifact names are attempt-specific. A carried-over successful Build with no
  matching artifact fails promptly with that instruction, rather than waiting for
  an artifact no job will produce. The attempt start/completion timestamps identify
  carried-over jobs because GitHub may relabel their `run_attempt`. A current
  attempt Build still waits for artifact visibility. E2E setup stays parallel with Build.
- Third parties: GitHub Actions/cache/artifacts, public GHCR, npm/pnpm, Playwright.
  No paid service, new account or user credential. Registry/cache availability,
  cold image pulls and pinned-image security updates remain operational limits.
- Existing action versions emit Node 20 runtime-migration warnings; app Node is 24.
  Update action majors separately with acceptance, not as unmeasured scope expansion.
- Never publish auth states, cookies, wrapped keys or production data. Retry traces
  can contain disposable test data; existing artifact policy still applies.
- Next compiler cache remains disabled. No paid remote-cache service, PostgreSQL
  parallelism or broad sharding is introduced by this work.

## Branch and trial audit

Phase PRs, all merged into integration only:
[#39](https://github.com/AJahann/cipher/pull/39),
[#40](https://github.com/AJahann/cipher/pull/40),
[#41](https://github.com/AJahann/cipher/pull/41),
[#42](https://github.com/AJahann/cipher/pull/42),
[#43](https://github.com/AJahann/cipher/pull/43).

Trial ledgers: [cache](e2e-trials.md), [video](e2e-video-trials.md),
[image](e2e-phase3-trials.md), [fixtures](e2e-phase4-trials.md),
[two workers](e2e-phase5-trials.md). Exact sources are in the JSON evidence.
The final PR must pass full acceptance and stay open for a human merge.
