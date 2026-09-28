# Send-message pending-paint profile

## Interaction and milestone

**Interaction:** activate **Send message** → pending message bubble painted.

- Start: capturing `click` event on the button with accessible name `Send message`.
- End: the second `requestAnimationFrame` after the matching message paragraph enters the DOM. The extra frame ensures the DOM commit has crossed a paint opportunity.
- Scope: this interaction only. Navigation, unlock, contact selection, and the socket acknowledgement are outside the timed milestone.

## Experiment

| Variable | Fixed value |
|---|---|
| Browser | Chromium 153.0.8010.12, headless |
| Build | Next.js production build from baseline `738f2f47ea55e5038834935863f9771cf52b6c86` |
| Hardware | 2 vCPU, Intel Xeon @ 2.90 GHz; Chrome 4× CPU throttling |
| Messages before each run | 0 |
| Cache | Warm browser HTTP cache; fresh page and React state per run |
| Network | Unthrottled localhost fixture; Socket.IO ack delayed by 250 ms |
| Runs | 1 warm-up, then 20 recorded repetitions per version |
| React Strict Mode | Not applicable to evidence: production build only; development timings excluded |

The fixture and runner are in `perf/send-message-fixture.mjs` and `perf/profile-send-message.mjs`. Raw measurements, including every main-thread metric, are in `perf/send-message-before.json` and `perf/send-message-after.json`.

## Diagnosis before editing

Chrome's Performance-domain counters showed that the milestone was local main-thread work, not transport:

- scripting: p50 **7.7 ms**, p95 **12.2 ms**;
- style recalculation: p50 **6.0 ms**, p95 **9.3 ms**;
- layout: p50 **1.2 ms**, p95 **3.5 ms**;
- no HTTP response or Socket.IO acknowledgement gates the pending bubble.

`MessageList` started a smooth `scrollIntoView` effect for every new `messages` array, including the first optimistic bubble. That adds animated scroll/style work directly inside the measured paint path. The dominant cost was browser main-thread scripting and rendering; network was not on the critical path.

## Targeted correction

Changed the message-list auto-scroll from `behavior: 'smooth'` to `behavior: 'auto'`. The list still reaches the newest message, but it no longer schedules a smooth-scroll animation on each realtime or optimistic update.

No memoization, virtualization, dynamic import, or unrelated state refactor was added.

## Raw interaction durations (ms)

| Run | Before | After |
|---:|---:|---:|
| 1 | 38.0 | 17.7 |
| 2 | 19.5 | 22.6 |
| 3 | 20.7 | 17.5 |
| 4 | 16.1 | 17.3 |
| 5 | 18.0 | 20.9 |
| 6 | 17.6 | 19.4 |
| 7 | 16.5 | 36.5 |
| 8 | 17.2 | 15.6 |
| 9 | 27.9 | 20.8 |
| 10 | 17.1 | 20.3 |
| 11 | 24.5 | 23.0 |
| 12 | 16.8 | 18.3 |
| 13 | 18.8 | 18.3 |
| 14 | 18.1 | 16.2 |
| 15 | 29.8 | 17.9 |
| 16 | 17.4 | 13.8 |
| 17 | 20.9 | 18.1 |
| 18 | 15.6 | 19.5 |
| 19 | 16.9 | 13.6 |
| 20 | 14.9 | 15.6 |

## Result

```text
p50: 17.6 ms → 18.1 ms
p95: 29.8 ms → 23.0 ms
worst run: 38.0 ms → 36.5 ms
dominant cost: main-thread scripting + smooth-scroll/style work → main-thread scripting; style tail reduced
```

- p50 changed by **+0.5 ms (+2.8%)**: effectively unchanged and not claimed as a win.
- p95 improved by **6.8 ms (22.8%)**.
- worst run improved by **1.5 ms (3.9%)**.
- Style-recalculation p50 changed from **6.0 ms** to **5.2 ms**; its tail remains noisy, so the claim is limited to the measured interaction distribution above.

## Disproved attempt

Painting pending state before awaiting encryption was also tested. It regressed the same benchmark to p50 **20.3 ms** and p95 **33.4 ms**, because the already-resolved crypto promises continued in the microtask queue before the browser's paint opportunity. That change was reverted and is not part of the correction.

## Verification

- `NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 pnpm --filter web build` — passed.
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 pnpm test:unit:web` — 18 tests passed.
- `pnpm test:unit:ui-web` — 13 tests passed.
- Oxlint 1.85 did not complete: both repository-wide and targeted runs panicked in `oxc_allocator` before reporting diagnostics. This is a lint-tool crash, not a passing lint result.
