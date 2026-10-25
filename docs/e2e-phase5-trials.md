# E2E phase 5: corrected two-worker trials

Identical non-Markdown source in three full successful acceptance runs.
Earlier development runs and rejected flake are disclosed in E2E-PERFORMANCE.md.

- [40142453275](https://github.com/AJahann/cipher/actions/runs/40142453275): E2E 83 s; containers 33 s; Playwright command 14 s. Exact cache hit: true.
- [40142662927](https://github.com/AJahann/cipher/actions/runs/40142662927): E2E 72 s; containers 33 s; Playwright command 13 s. Exact cache hit: true.
- [40142930119](https://github.com/AJahann/cipher/actions/runs/40142930119): E2E 63 s; containers 25 s; Playwright command 13 s. Exact cache hit: true.

Median 72 s; range 63–83 s. Retain bounded two-worker default; no linear-speedup claim.
