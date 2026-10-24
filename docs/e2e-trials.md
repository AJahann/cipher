# E2E hosted trial ledger

Runtime configuration is unchanged between measurement-only commits within a phase.
These commits retrigger full PR CI because each phase PR also contains runtime/tooling changes.
Do not count overlapping or cancelled runs as successful comparisons.

## Phase 1: restore-only cache

- Trial 1: [40137110848](https://github.com/AJahann/cipher/actions/runs/40137110848), full CI success. E2E 105 s; containers 54 s; Playwright command 20 s; cache-restore wrapper 1 s; post-restore 0 s. New namespace population included.
- Trial 2: requested by this documentation-only commit; same runtime configuration.
- Trial 3: pending.

All timings use GitHub job/step timestamps at one-second resolution. Retry counts are not inferred from job timestamps.
