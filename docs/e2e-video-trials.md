# Phase 2: retry-only video trials

No runtime changes between measurement-only commits in this cohort.

1. [40137684774](https://github.com/AJahann/cipher/actions/runs/40137684774): full CI success; E2E 84 s, containers 42 s, Playwright command 15 s.
2. Requested by this documentation-only commit.
3. Pending.

Local Chromium suite: 14/14 passed after installing the missing local ffmpeg helper (the earlier harness attempt failed because ffmpeg was absent, not an application assertion).

Isolated recording smoke test intentionally failed once and succeeded on first retry. Filesystem verification confirmed: initial failure screenshot present, no initial video, first-retry video and trace.zip present. This intentional failure is not part of the application suite or hosted performance sample.
