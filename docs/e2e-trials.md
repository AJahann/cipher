# E2E hosted trial ledger

Runtime configuration is unchanged between measurement-only commits within a phase.
These commits retrigger full PR CI because each phase PR also contains runtime/tooling changes.
Do not count overlapping or cancelled runs as successful comparisons.

## Phase 1: restore-only cache

- Trial 1: [40137110848](https://github.com/AJahann/cipher/actions/runs/40137110848), full CI success. E2E 105 s; containers 54 s; Playwright command 20 s; cache-restore wrapper 1 s; post-restore 0 s. New namespace population included.
- Trial 2: [40137297269](https://github.com/AJahann/cipher/actions/runs/40137297269), all nine checks successful. E2E 87 s; containers 38 s; Playwright command 21 s; restore 1 s; post-restore 0 s.
- Trial 3: [40137451625](https://github.com/AJahann/cipher/actions/runs/40137451625), full CI success. E2E 93 s; containers 49 s; Playwright command 18 s; restore 1 s; post-restore 0 s.

All timings use GitHub job/step timestamps at one-second resolution. Retry counts are not inferred from job timestamps. Container initialization includes PostgreSQL, not only image pulling.

## Phase 2: retry-only video

- Trial 1: requested by the phase implementation commit.
- Trials 2 and 3: pending.
