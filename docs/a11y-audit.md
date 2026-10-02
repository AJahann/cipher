# Accessibility audit: axe + Lighthouse, every route × SessionGate state

Baseline: `main` at `556193f`. Fixes are on branch `feat/a11y-audit`.
Raw evidence lives in `a11y/results/` (`axe-before.json`, `axe-after.json`,
`lighthouse-before.json`, `lighthouse-after.json`). `node a11y/scan.mjs <label>` also writes a full chat
screenshot to `a11y/results/chat-<label>.png` (gitignored) for visual before/after.

## Method

- **axe-core 4.13 via `@axe-core/playwright`**, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, plus
  `best-practice`, against a **production build** (`next build && next start`), Chromium, 1280×720.
  Script: `node a11y/scan.mjs <label>`.
- **Lighthouse 13.5** accessibility category (desktop). Script: `node a11y/lighthouse.mjs <label>`.
  Navigation mode for states you can reach by URL. Snapshot mode for states that exist only in memory.
- **Ready state.** `storageState` restores the cookie and the *wrapped* key but never the in-memory private
  key, so restored storage always lands on `need-unlock`. Every ready-state scan unlocks (or logs in) first,
  then scans. The scan asserts each state was reached (a heading or control visible) before running axe.
- **`checking` state.** `SessionGate` "checking" and `AuthGuard` loading render the same `LoadingScreen`, and it
  is also the prerendered HTML for `/chat`. It only lasts one effect tick in a live session, so it is held for
  scanning by blocking `/_next/static/**/*.js` (pre-hydration markup).

## Coverage: route × state

| Route | SessionGate / guard state | How reached | axe before (nodes) | axe after |
|---|---|---|---|---|
| `/chat` | checking (prerendered loading) | JS blocked | 4: contrast 1, main 1, h1 1, region 1 | 0 |
| `/` | anonymous · login | direct | 11: contrast 5, main 1, region 5 | 0 |
| `/` | anonymous · login validation errors | submit empty | 11 | 0 |
| `/` | anonymous · authentication failed | bad credentials | 11 | 0 |
| `/` | anonymous · register | mode switch | 13: contrast 6, main 1, region 6 | 0 |
| `/chat → /` | no session (AuthGuard redirect) | fresh context | 11 | 0 |
| `/chat → /` | **need-login** (cookie, no wrapped key) | cookies only | 11 | 0 |
| `/chat` | **need-unlock** | storageState | 13: contrast 9, main 1, region 3 | 0 |
| `/chat` | need-unlock · wrong passphrase | bad passphrase | 12 | 0 |
| `/chat` | **ready** · no conversation | unlock | 8: contrast 7, h1 1 | 0 |
| `/chat` | ready · empty conversation | open contact | 8 | 0 |
| `/chat` | ready · conversation with messages | send both ways | 11 | 0 |
| `/chat` | ready · keyboard-shortcuts dialog | open dialog | 1 | 0 |
| `/chat` | ready (after unlock from storageState) · messages | storageState → unlock | 11 | 0 |

**Totals before:** 136 violation nodes across 14 states, from 4 rules:
`color-contrast` (serious) ×87, `region` (moderate) ×38, `landmark-one-main` (moderate) ×9,
`page-has-heading-one` (moderate) ×2. There were no critical findings. **After: 0 in every state**,
including best-practice rules.

## Lighthouse accessibility score

| Route | State | Mode | Before | After | Failing audits before |
|---|---|---|---|---|---|
| `/chat` | checking (prerendered loading) | snapshot | 80 | 100 | color-contrast, landmark-one-main |
| `/` | anonymous · login | navigation | 93 | 100 | color-contrast, landmark-one-main |
| `/` | anonymous · register | snapshot | 93 | 100 | color-contrast, landmark-one-main |
| `/chat` | ready · no conversation | snapshot | 95 | 100 | color-contrast |
| `/chat` | ready · conversation with messages | snapshot | 96 | 100 | color-contrast |
| `/chat` | need-unlock | navigation | 94 | 100 | color-contrast, landmark-one-main |
| `/chat → /` | need-login (SessionGate redirect) | navigation | 93 | 100 | color-contrast, landmark-one-main |

## Root causes and fixes (by impact)

Each finding in the appendix maps to one of these causes. The fixes target the cause. No rule was disabled,
and no `aria-*` was added to hide a finding.

### F1a — serious — `--cipher-muted` text is below 4.5:1

`#6b6b75` measured 3.75:1 on bg, 3.57:1 on surface and 3.35:1 on surface-2. It is used for every label,
hint, the "conversations" heading, contact initials, the keyboard-shortcuts button and dialog copy, and the
empty and loading text (all 9–12px).

**Fix:** raised the token to `#8a8a94`, which gives 5.79, 5.52 and 5.18:1. It still reads as secondary
against `--cipher-text`. `tokens.css` and `colors.ts` are kept in sync.

### F1b — serious — white text on the accent fill

White on `#7c6dfa` is 3.87:1 (primary buttons, my message bubbles). `text-white/60` meta (time, delivery
status) on that fill is 2.38:1.

**Fix:** a new `--cipher-accent-strong: #5b4bdb` (and `-hover: #4f40c9`) for **fills behind white text**:
`Button` default, own bubbles, and the send button. White is 6.04:1 and the meta text, now `text-white/85`,
is 4.85:1. `--cipher-accent` stays as is for text, dots and focus rings on dark backgrounds (4.87:1), where
darkening it would have broken that contrast instead.

Also fixed along the way:

- The disconnected badge referenced an undefined `--cipher-dangerMuted`. It now uses a defined
  `--cipher-danger-muted`.
- Input and composer borders were 1.24:1 (WCAG 1.4.11 needs 3:1 for a control boundary). They now use
  `--cipher-border-input` (3.36:1). axe doesn't check this one; it was a manual finding.

### F2 — moderate — no `main` landmark, so content sits outside landmarks

`AuthForm`, `UnlockForm` and `LoadingScreen` rendered bare `<div>`s, so the sign-in, unlock and loading
pages had no `main`, and every block was flagged by `region`. **Fix:** each one now renders `<main>`, and no
page ever has two. The chat already had `<main>` in `ChatPage` and `EmptyState`.

### F3 — moderate — no level-one heading

The no-conversation state and the loading page had no `h1`. **Fix:** the visible empty and loading text is
now the `h1`, with the same styling. Related changes:

- The chat `h1` was always "Chat". It is now the contact's username (`ChatHeader title`, `dir="auto"`).
- Routes have distinct `<title>`s: "Sign in · Cipher" and "Conversations · Cipher" (WCAG 2.4.2).

### Accessible names (found while writing role queries)

- **Contact buttons.** The name was "BO bob-…" because the decorative initials avatar was inside the button.
  The avatar is now `aria-hidden` (it duplicates the name), so the name is exactly the username.
- **Message bubbles.** The avatar initials came from the sender's UUID ("BA"), and nothing said who sent a
  message. The avatar now shows the peer's initials and is `aria-hidden`. Each bubble starts with a
  visually hidden "You:" or "<username>:" sender label.

## Direction (bidi)

The test string, sent from Alice, is Persian with embedded English, digits, a dot inside a word, and
trailing punctuation:

`سلام! این پیام با React 19 و Next.js تست شد.`

and the reply (first strong character is Latin, so it must stay LTR): `Deploy شد؟ yes, deploy کردم!`

**Before.** The bubble `<p>` and the composer inherited the document's `ltr`. The Persian sentence laid out
as an LTR paragraph:

- The final `.` sat on the far right, after Latin text, instead of at the end of the RTL sentence.
- "!" after سلام jumped to the wrong side.
- Text was left-aligned in the bubble and the composer.


**After.** `dir="auto"` on the bubble text and on the `ChatInput` textarea. Each message resolves its own
base direction from its first strong character:

- The Persian message is RTL: right-aligned, `.` at the sentence end on the left, and "React 19" and
  "Next.js" kept as intact LTR runs.
- The English-first reply stays LTR.
- The composer flips while typing.
- Usernames in the sidebar are wrapped in `<bdi>`, so a Persian name doesn't reorder the " · opening…"
  suffix.


The E2E spec checks this: both the composer and the sent message match `:dir(rtl)` for the Persian string.

### Physical → logical CSS in the chat UI

| Component | Before | After |
|---|---|---|
| `message-bubble.tsx` | `rounded-br-sm` / `rounded-bl-sm` | `rounded-ee-sm` / `rounded-es-sm` |
| `sidebar-item.tsx` | `text-left`, `border-l-2`, `border-l-[…]` | `text-start`, `border-s-2`, `border-s-[…]` |
| `sidebar.tsx` | `border-r` | `border-e` |
| `chat-header.tsx` | `ml-auto` | `ms-auto` |
| `apps/web/src/components/sidebar.tsx` | `text-left`, `border-r` (dead copy, never imported) | deleted |

The remaining spacing utilities are already logical in Tailwind v4 (`px-*` → `padding-inline`,
`justify-end` / `items-end` follow flow direction). A grep for `ml-|mr-|pl-|pr-|left|right|*-l-|*-r-` in
`packages/ui-web/src` and `apps/web/src` now matches nothing.

## Tests

**Unit tests (RTL `getByRole` / `getByLabelText`, no test IDs).**

- `message-bubble`: the mixed-direction text has `dir="auto"`. Sender labels are "bob:" and "You:", and the
  avatar is outside the accessibility tree.
- `chat-input`: the composer has `dir="auto"`.
- `sidebar` (new): the contact name is exactly the username, including a Persian name. The pending suffix
  stays outside `<bdi>`.
- `chat-header`: the contact name is the `h1`.
- `app-shell` and `loading-screen` (new): `main` plus `h1`.
- `auth-form` and `unlock-form` (new): the form is inside `main`.

**E2E (`apps/web/e2e/a11y.spec.ts`, axe).**

- Covers: checking, `/` (login, validation, auth failure, register), need-login, need-unlock (plus the
  error), and ready (empty, conversation with the mixed-direction message, shortcuts dialog).
- It fails on any critical or serious violation and attaches the full axe JSON to the report.
- Locally, Chromium ran 9 passed. The pre-fix code fails it in every state (`color-contrast`).

## Not fixed: manual findings axe doesn't catch (follow-up)

These are focus-management bugs found in code review. None of them is an axe violation:

1. Activating **Send** with the keyboard clears the composer and *disables* the button, so focus drops to
   `<body>`.
2. **Retry** unmounts itself when the message goes back to `sending`, so focus is lost.
3. When the composer becomes `disabled` on reconnect, the user loses focus mid-typing.
4. `Button` disables itself while loading, so pressing submit with the keyboard drops focus.
5. `UnlockForm` failure: the error isn't announced and focus isn't moved to it. `AuthForm` already does
   both.

Suggested fix: use `aria-disabled` plus a guard for controls that change state while focused, or move
focus on purpose. Each fix should come with a `document.activeElement` test.

## Reproduce

```bash
# API + Postgres (migrations in packages/api/drizzle) + production web build on :3000
cd apps/web && CI=true npx next build && npx next start -p 3000
node a11y/scan.mjs after          # axe, every state  → a11y/results/axe-after.json
node a11y/lighthouse.mjs after    # Lighthouse        → a11y/results/lighthouse-after.json (CHROME_PATH to override)
pnpm test:e2e --project=chromium  # includes e2e/a11y.spec.ts
```

**Notes.**

- `scan.mjs` writes a session cookie to `a11y/results/.alice-state.json`. It is gitignored.
- The baseline `checking` row was backfilled with `a11y/scan-checking.mjs` against a rebuilt `main` after
  that state was added to the scan.

## Appendix: every axe finding before the fixes (136 nodes)

Columns: rule id, impact, route and state, offending node (truncated `outerHTML`), axe detail, and the cause
from above. After the fixes, every row resolves to 0 (`a11y/results/axe-after.json`).

| # | Route | SessionGate state | Rule | Impact | Offending node | Detail | Fix |
|---|---|---|---|---|---|---|---|
| 1 | `/chat` | checking (prerendered loading, pre-hydration) | `color-contrast` | serious | `<p class="font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">loading...</p>` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 2 | `/chat` | checking (prerendered loading, pre-hydration) | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 3 | `/chat` | checking (prerendered loading, pre-hydration) | `page-has-heading-one` | moderate | `<html lang="en" class="h-full antialiased">` | Page should contain a level-one heading | F3 |
| 4 | `/chat` | checking (prerendered loading, pre-hydration) | `region` | moderate | `<div class="flex flex-1 items-center justify-center"><p class="font-(--cipher-font-mono) t` | All page content should be contained by landmarks | F2 |
| 5 | `/` | anonymous · login mode | `color-contrast` | serious | `<button type="button" aria-pressed="false" class="flex-1 py-2 font-(--...">` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 6 | `/` | anonymous · login mode | `color-contrast` | serious | `<p class="mt-1 font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">// session key` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 7 | `/` | anonymous · login mode | `color-contrast` | serious | `<label for="username" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0.0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 8 | `/` | anonymous · login mode | `color-contrast` | serious | `<label for="passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 9 | `/` | anonymous · login mode | `color-contrast` | serious | `<button type="submit" class="flex w-full items-ce...">` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 10 | `/` | anonymous · login mode | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 11 | `/` | anonymous · login mode | `region` | moderate | `<div class="mb-10 flex flex-col gap-3">` | All page content should be contained by landmarks | F2 |
| 12 | `/` | anonymous · login mode | `region` | moderate | `<fieldset aria-label="Authentication mode" class="mb-8 flex min-w-0 overflow-hidden rounde` | All page content should be contained by landmarks | F2 |
| 13 | `/` | anonymous · login mode | `region` | moderate | `<div class="mb-7"><h1 class="font-(--cipher-font-sans) text-[22px] tracking-tight text-(--` | All page content should be contained by landmarks | F2 |
| 14 | `/` | anonymous · login mode | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 15 | `/` | anonymous · login mode | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 16 | `/` | anonymous · login validation errors | `color-contrast` | serious | `<button type="button" aria-pressed="false" class="flex-1 py-2 font-(--...">` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 17 | `/` | anonymous · login validation errors | `color-contrast` | serious | `<p class="mt-1 font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">// session key` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 18 | `/` | anonymous · login validation errors | `color-contrast` | serious | `<label for="username" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0.0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 19 | `/` | anonymous · login validation errors | `color-contrast` | serious | `<label for="passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 20 | `/` | anonymous · login validation errors | `color-contrast` | serious | `<button type="submit" class="flex w-full items-ce...">` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 21 | `/` | anonymous · login validation errors | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 22 | `/` | anonymous · login validation errors | `region` | moderate | `<div class="mb-10 flex flex-col gap-3">` | All page content should be contained by landmarks | F2 |
| 23 | `/` | anonymous · login validation errors | `region` | moderate | `<fieldset aria-label="Authentication mode" class="mb-8 flex min-w-0 overflow-hidden rounde` | All page content should be contained by landmarks | F2 |
| 24 | `/` | anonymous · login validation errors | `region` | moderate | `<div class="mb-7"><h1 class="font-(--cipher-font-sans) text-[22px] tracking-tight text-(--` | All page content should be contained by landmarks | F2 |
| 25 | `/` | anonymous · login validation errors | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 26 | `/` | anonymous · login validation errors | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 27 | `/` | anonymous · authentication failed | `color-contrast` | serious | `<button type="button" aria-pressed="false" class="flex-1 py-2 font-(--...">` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 28 | `/` | anonymous · authentication failed | `color-contrast` | serious | `<p class="mt-1 font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">// session key` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 29 | `/` | anonymous · authentication failed | `color-contrast` | serious | `<label for="username" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0.0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 30 | `/` | anonymous · authentication failed | `color-contrast` | serious | `<label for="passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 31 | `/` | anonymous · authentication failed | `color-contrast` | serious | `<button type="submit" class="flex w-full items-ce...">` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 32 | `/` | anonymous · authentication failed | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 33 | `/` | anonymous · authentication failed | `region` | moderate | `<div class="mb-10 flex flex-col gap-3">` | All page content should be contained by landmarks | F2 |
| 34 | `/` | anonymous · authentication failed | `region` | moderate | `<fieldset aria-label="Authentication mode" class="mb-8 flex min-w-0 overflow-hidden rounde` | All page content should be contained by landmarks | F2 |
| 35 | `/` | anonymous · authentication failed | `region` | moderate | `<div class="mb-7"><h1 class="font-(--cipher-font-sans) text-[22px] tracking-tight text-(--` | All page content should be contained by landmarks | F2 |
| 36 | `/` | anonymous · authentication failed | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 37 | `/` | anonymous · authentication failed | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 38 | `/` | anonymous · register mode | `color-contrast` | serious | `<button type="button" aria-pressed="false" class="flex-1 py-2 font-(--...">` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 39 | `/` | anonymous · register mode | `color-contrast` | serious | `<p class="mt-1 font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">// keys genera` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 40 | `/` | anonymous · register mode | `color-contrast` | serious | `<label for="username" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0.0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 41 | `/` | anonymous · register mode | `color-contrast` | serious | `<label for="passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 42 | `/` | anonymous · register mode | `color-contrast` | serious | `<label for="confirm-passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tra` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 43 | `/` | anonymous · register mode | `color-contrast` | serious | `<button type="submit" class="flex w-full items-ce...">` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 44 | `/` | anonymous · register mode | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 45 | `/` | anonymous · register mode | `region` | moderate | `<div class="mb-10 flex flex-col gap-3">` | All page content should be contained by landmarks | F2 |
| 46 | `/` | anonymous · register mode | `region` | moderate | `<fieldset aria-label="Authentication mode" class="mb-8 flex min-w-0 overflow-hidden rounde` | All page content should be contained by landmarks | F2 |
| 47 | `/` | anonymous · register mode | `region` | moderate | `<div class="mb-7"><h1 class="font-(--cipher-font-sans) text-[22px] tracking-tight text-(--` | All page content should be contained by landmarks | F2 |
| 48 | `/` | anonymous · register mode | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 49 | `/` | anonymous · register mode | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 50 | `/` | anonymous · register mode | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 51 | `/chat → /` | no session (AuthGuard redirect) | `color-contrast` | serious | `<button type="button" aria-pressed="false" class="flex-1 py-2 font-(--...">` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 52 | `/chat → /` | no session (AuthGuard redirect) | `color-contrast` | serious | `<p class="mt-1 font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">// session key` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 53 | `/chat → /` | no session (AuthGuard redirect) | `color-contrast` | serious | `<label for="username" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0.0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 54 | `/chat → /` | no session (AuthGuard redirect) | `color-contrast` | serious | `<label for="passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 55 | `/chat → /` | no session (AuthGuard redirect) | `color-contrast` | serious | `<button type="submit" class="flex w-full items-ce...">` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 56 | `/chat → /` | no session (AuthGuard redirect) | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 57 | `/chat → /` | no session (AuthGuard redirect) | `region` | moderate | `<div class="mb-10 flex flex-col gap-3">` | All page content should be contained by landmarks | F2 |
| 58 | `/chat → /` | no session (AuthGuard redirect) | `region` | moderate | `<fieldset aria-label="Authentication mode" class="mb-8 flex min-w-0 overflow-hidden rounde` | All page content should be contained by landmarks | F2 |
| 59 | `/chat → /` | no session (AuthGuard redirect) | `region` | moderate | `<div class="mb-7"><h1 class="font-(--cipher-font-sans) text-[22px] tracking-tight text-(--` | All page content should be contained by landmarks | F2 |
| 60 | `/chat → /` | no session (AuthGuard redirect) | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 61 | `/chat → /` | no session (AuthGuard redirect) | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 62 | `/chat` | ready · no conversation selected | `color-contrast` | serious | `<p class="font-[var(--cipher-font-mono)] text-[10px] uppercase tracking-[0.1em] text-[var(` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 63 | `/chat` | ready · no conversation selected | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 64 | `/chat` | ready · no conversation selected | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 65 | `/chat` | ready · no conversation selected | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 66 | `/chat` | ready · no conversation selected | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 67 | `/chat` | ready · no conversation selected | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 68 | `/chat` | ready · no conversation selected | `color-contrast` | serious | `<p class="font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">// select a convers` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 69 | `/chat` | ready · no conversation selected | `page-has-heading-one` | moderate | `<html lang="en" class="h-full antialiased">` | Page should contain a level-one heading | F3 |
| 70 | `/chat` | ready · empty conversation | `color-contrast` | serious | `<p class="font-[var(--cipher-font-mono)] text-[10px] uppercase tracking-[0.1em] text-[var(` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 71 | `/chat` | ready · empty conversation | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 72 | `/chat` | ready · empty conversation | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 73 | `/chat` | ready · empty conversation | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 74 | `/chat` | ready · empty conversation | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 75 | `/chat` | ready · empty conversation | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 76 | `/chat` | ready · empty conversation | `color-contrast` | serious | `<button type="button" class="ml-auto rounded px-2 py-1 font-[var(--cipher-font-mono)] text` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 77 | `/chat` | ready · empty conversation | `color-contrast` | serious | `<output class="block font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">// no me` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 78 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<p class="font-[var(--cipher-font-mono)] text-[10px] uppercase tracking-[0.1em] text-[var(` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 79 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 80 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 81 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 82 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 83 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 84 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<button type="button" class="ml-auto rounded px-2 py-1 font-[var(--cipher-font-mono)] text` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 85 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<p class="font-[var(--cipher-font-sans)] text-[13px] leading-relaxed">سلام! این پیام با Re` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 86 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[9px] text-white/60">sent</span>` | 2.38:1 (#cbc5fd on #7c6dfa) | F1b |
| 87 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-white/60">12:12</span>` | 2.38:1 (#cbc5fd on #7c6dfa) | F1b |
| 88 | `/chat` | ready · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[9px] text-[var(--cipher-muted)]">BA</spa` | 3.35:1 (#6b6b75 on #18181c) | F1a |
| 89 | `/chat` | ready · keyboard-shortcuts dialog open | `color-contrast` | serious | `<p class="mt-1 text-[12px] text-[var(--cipher-muted)]">Work in a conversation without reac` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 90 | `/chat` | need-unlock | `color-contrast` | serious | `<p class="font-[var(--cipher-font-mono)] text-[10px] uppercase tracking-[0.1em] text-[var(` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 91 | `/chat` | need-unlock | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 92 | `/chat` | need-unlock | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 93 | `/chat` | need-unlock | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 94 | `/chat` | need-unlock | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 95 | `/chat` | need-unlock | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 96 | `/chat` | need-unlock | `color-contrast` | serious | `<p class="mt-1 font-[var(--cipher-font-mono)] text-[11px] text-[var(--cipher-muted)]">// e` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 97 | `/chat` | need-unlock | `color-contrast` | serious | `<label for="passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 98 | `/chat` | need-unlock | `color-contrast` | serious | `<button type="submit" class="flex w-full items-ce...">` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 99 | `/chat` | need-unlock | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 100 | `/chat` | need-unlock | `region` | moderate | `<div class="mb-10 flex flex-col gap-3">` | All page content should be contained by landmarks | F2 |
| 101 | `/chat` | need-unlock | `region` | moderate | `<div class="mb-7"><h1 class="font-[var(--cipher-font-sans)] text-[22px] font-light trackin` | All page content should be contained by landmarks | F2 |
| 102 | `/chat` | need-unlock | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 103 | `/chat` | need-unlock · wrong passphrase | `color-contrast` | serious | `<p class="font-[var(--cipher-font-mono)] text-[10px] uppercase tracking-[0.1em] text-[var(` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 104 | `/chat` | need-unlock · wrong passphrase | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 105 | `/chat` | need-unlock · wrong passphrase | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 106 | `/chat` | need-unlock · wrong passphrase | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 107 | `/chat` | need-unlock · wrong passphrase | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 108 | `/chat` | need-unlock · wrong passphrase | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 109 | `/chat` | need-unlock · wrong passphrase | `color-contrast` | serious | `<p class="mt-1 font-[var(--cipher-font-mono)] text-[11px] text-[var(--cipher-muted)]">// e` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 110 | `/chat` | need-unlock · wrong passphrase | `color-contrast` | serious | `<label for="passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 111 | `/chat` | need-unlock · wrong passphrase | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 112 | `/chat` | need-unlock · wrong passphrase | `region` | moderate | `<div class="mb-10 flex flex-col gap-3">` | All page content should be contained by landmarks | F2 |
| 113 | `/chat` | need-unlock · wrong passphrase | `region` | moderate | `<div class="mb-7"><h1 class="font-[var(--cipher-font-sans)] text-[22px] font-light trackin` | All page content should be contained by landmarks | F2 |
| 114 | `/chat` | need-unlock · wrong passphrase | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 115 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<p class="font-[var(--cipher-font-mono)] text-[10px] uppercase tracking-[0.1em] text-[var(` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 116 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 117 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 118 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 119 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">BO</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 120 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-[var(--cipher-muted)]">AL</sp` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 121 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<button type="button" class="ml-auto rounded px-2 py-1 font-[var(--cipher-font-mono)] text` | 3.57:1 (#6b6b75 on #111113) | F1a |
| 122 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<p class="font-[var(--cipher-font-sans)] text-[13px] leading-relaxed">سلام! این پیام با Re` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 123 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[9px] text-white/60">sent</span>` | 2.38:1 (#cbc5fd on #7c6dfa) | F1b |
| 124 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[10px] text-white/60">12:12</span>` | 2.38:1 (#cbc5fd on #7c6dfa) | F1b |
| 125 | `/chat` | ready (after unlock) · conversation with messages | `color-contrast` | serious | `<span class="font-[var(--cipher-font-mono)] text-[9px] text-[var(--cipher-muted)]">BA</spa` | 3.35:1 (#6b6b75 on #18181c) | F1a |
| 126 | `/chat → /` | need-login (SessionGate redirect) | `color-contrast` | serious | `<button type="button" aria-pressed="false" class="flex-1 py-2 font-(--...">` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 127 | `/chat → /` | need-login (SessionGate redirect) | `color-contrast` | serious | `<p class="mt-1 font-(--cipher-font-mono) text-[11px] text-(--cipher-muted)">// session key` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 128 | `/chat → /` | need-login (SessionGate redirect) | `color-contrast` | serious | `<label for="username" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0.0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 129 | `/chat → /` | need-login (SessionGate redirect) | `color-contrast` | serious | `<label for="passphrase" class="font-(--cipher-font-mono) text-[10px] uppercase tracking-[0` | 3.75:1 (#6b6b75 on #0a0a0b) | F1a |
| 130 | `/chat → /` | need-login (SessionGate redirect) | `color-contrast` | serious | `<button type="submit" class="flex w-full items-ce...">` | 3.87:1 (#ffffff on #7c6dfa) | F1b |
| 131 | `/chat → /` | need-login (SessionGate redirect) | `landmark-one-main` | moderate | `<html lang="en" class="h-full antialiased">` | Document should have one main landmark | F2 |
| 132 | `/chat → /` | need-login (SessionGate redirect) | `region` | moderate | `<div class="mb-10 flex flex-col gap-3">` | All page content should be contained by landmarks | F2 |
| 133 | `/chat → /` | need-login (SessionGate redirect) | `region` | moderate | `<fieldset aria-label="Authentication mode" class="mb-8 flex min-w-0 overflow-hidden rounde` | All page content should be contained by landmarks | F2 |
| 134 | `/chat → /` | need-login (SessionGate redirect) | `region` | moderate | `<div class="mb-7"><h1 class="font-(--cipher-font-sans) text-[22px] tracking-tight text-(--` | All page content should be contained by landmarks | F2 |
| 135 | `/chat → /` | need-login (SessionGate redirect) | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
| 136 | `/chat → /` | need-login (SessionGate redirect) | `region` | moderate | `<div class="flex flex-col gap-1.5">` | All page content should be contained by landmarks | F2 |
