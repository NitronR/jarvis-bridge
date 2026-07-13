# Session message count in ChatsDrawer — design

**Date:** 2026-07-13
**Status:** Approved (pending spec review)

## Problem

The right-hand ChatsDrawer pop-up shows each past session as a card with
title, relative time, backend badge, workspace, optional group, and an
optional pinned pill. It does not show how long the conversation was, so
users can't tell at a glance which session is the meaty one versus the
two-line exchange from yesterday.

We want a small `N msgs` pill on each card, where `N` is the number of
`ChatHistoryEntry` items in that session's `history` (user + assistant
turns combined — chosen over "user turns only" so the number reflects
the full conversation length).

## Constraints

- No backend changes. The wire already carries `history` on
  `GET /chat/init?sessionId=...`; the gateway should not grow a new
  integration surface for a cosmetic count (per `AGENTS.md`).
- Counts must survive a page reload. The user explicitly chose
  `localStorage` over in-memory.
- A stale count is worse than no count: when the server has new truth,
  the server must always win.

## Approach

Client-side. Each `ChatContext.init()` writes
`turnCounts[sessionId] = history.length` to React state and to
`localStorage`. The ChatsDrawer reads via a new `getTurnCount` prop and
renders a pill when the count is defined and non-zero. A `pruneTurnCounts`
hook runs after every `GET /chat/sessions` to garbage-collect entries
for sessions the backend no longer reports.

Sessions never opened in this browser show no pill. Sessions whose
`history` is `[]` also show no pill (count = 0 renders nothing).

## Storage

- **Key:** `jarvis.turnCounts`
- **Value:** JSON `Record<string, number>` — `{ [sessionId]: count }`
- **Quota:** ~30 KB per 1000 sessions. Well under the 5 MB localStorage
  limit and consistent with `jarvis.lastChatsFilter` already used by
  the drawer.
- **Availability:** All reads/writes wrapped in `try/catch` matching the
  `safeGetStoredFilter` pattern in `ChatsDrawer.tsx:41-55`. Private-mode
  or storage-blocked browsers silently fall back to in-memory only.

## Data flow

1. `ChatProvider` mounts. The `useState` initializer reads
   `jarvis.turnCounts` from localStorage, validates it
   (`Record<string, number>`, numeric values), and seeds state. Lazy
   hydration — no `useEffect`, no first-render flash of empty counts.
2. User clicks a card in the drawer → `onSwitch(sessionId)` →
   `init(sessionId)` runs.
3. On successful init, the same `setState` batch that sets
   `state.history` also sets `turnCounts[sessionId] = history.length`.
   Then a write-through to `localStorage.setItem(KEY, JSON.stringify(...))`.
4. `GET /chat/sessions` returns. `ChatPanel` calls
   `pruneTurnCounts(new Set(sessions.map(s => s.sessionId)))`. Any
   stored entry whose key isn't in the server response is removed from
   state and from localStorage.
5. User reopens the drawer. Each card whose sessionId is in
   `turnCounts` with a value `> 0` shows the pill. Others show nothing.

## Edge cases

| Case | Behavior |
|---|---|
| `init()` returns `history: []` | `turnCounts[sid] = 0`. Drawer skips rendering. Persisted as `0`. |
| `init()` fails (sets `sessionId: null`) | No write. Prior count preserved. |
| `localStorage` corrupt / unavailable | `try/catch` → empty map, in-memory only. |
| Cross-tab | No `storage` event listener. Counts may briefly diverge between tabs; both self-correct on next `init()`. |
| `reset()` | Does **not** clear `turnCounts`. It only clears the active session; counts for other sessions must survive. |
| Session opened in another machine / CLI | Stored count becomes stale until next `init()` in this browser, then overwrites with truth. |
| Orphan entries (deleted sessions) | Pruned by `pruneTurnCounts` after every `/chat/sessions` response. |

## Components

### `ChatContext.tsx` (modified)

- New state field on `ChatState`:
  `turnCounts: Record<string, number>` (default `{}`).
- New methods on `ChatContextApi`:
  - `getTurnCount(sessionId: string): number | undefined` —
    returns the stored count (which can legitimately be `0` for a
    successfully-opened but empty session), or `undefined` if we've
    never seen this sessionId. The **drawer** decides whether `0`
    renders (it doesn't — see `ChatsDrawer` section below).
  - `pruneTurnCounts(keepIds: Set<string>): void`
- Lazy hydration: `useState(() => loadTurnCounts())` where
  `loadTurnCounts()` reads + validates localStorage with `try/catch`.
- `init()`: after the successful-response `setState`, also set
  `turnCounts: { ...s.turnCounts, [d.sessionId]: d.history.length }` and
  write through to localStorage.
- `reset()`: keep `turnCounts` (only `history`, `sessionId`, etc.
  reset).
- `pruneTurnCounts`: filter the map, `setState`, write through. Use
  `Set<string>` for O(1) membership.

### `ChatsDrawer.tsx` (modified)

- New optional prop: `getTurnCount?: (sessionId: string) => number | undefined`.
- In each card's `.cardMeta` row, after the existing badges, render:
  ```
  {getTurnCount && (() => {
    const n = getTurnCount(s.sessionId);
    return n ? <span className={styles.turnCount}>{n} msgs</span> : null;
  })()}
  ```
  (Inline IIFE to keep the early-return terse; or extract to a small
  component if preferred.)

### `ChatsDrawer.module.css` (modified)

- New `.turnCount` class. Matches the existing pill family (`.group`,
  `.pinPill`):
  - `font-size: 10px`
  - `padding: 2px 8px`
  - `border-radius: 10px`
  - `background: var(--color-surface-3)` (neutral, since this isn't a
    state — just metadata)
  - `color: var(--color-text-muted)`
  - `font-variant-numeric: tabular-nums` so digit widths don't jitter
    as counts change.

### `ChatPanel.tsx` (modified)

- Pull `getTurnCount` and `pruneTurnCounts` off `useChatContext()`.
- Pass `getTurnCount={getTurnCount}` to `<ChatsDrawer />`.
- In the `refreshSessions` flow (already called after every
  `/chat/sessions` fetch), call
  `pruneTurnCounts(new Set(sessions.map(s => s.sessionId)))`.

## Testing

Vitest. Two files, additive — no existing test changes required.

### `ChatContext.test.tsx`

1. `init()` with mocked `history` of length 7 →
   `getTurnCount(sid) === 7`.
2. Pre-seeded localStorage (`{"abc": 3}`) → `getTurnCount("abc") === 3`
   on mount without any `init()` call.
3. `pruneTurnCounts(new Set(["abc"]))` with stored `{abc: 3, def: 5}`
   leaves `{abc: 3}` and removes `def` from localStorage.
4. `reset()` does not clear `turnCounts`.
5. `init()` with `history: []` writes `0` for that sessionId.

### `ChatsDrawer.test.tsx`

1. `getTurnCount` returns `12` → card has text "12 msgs".
2. `getTurnCount` returns `0` → card has no count text.
3. `getTurnCount` returns `undefined` → card has no count text.
4. `getTurnCount` prop omitted → card has no count text (back-compat).

## Out of scope

- Per-tab `sessionStorage` variant — `localStorage` is what the user
  asked for.
- Showing counts for sessions never opened in this browser (would
  require either a backend change or a loadSession-per-session sweep).
- Cross-tab `storage` event sync — both tabs self-correct on next
  `init()`, which is good enough.
- Showing a separate "user turns" count alongside the total — single
  number is what was requested.

## Open questions

None at design time. Implementation may surface one if `pruneTurnCounts`
gets called before `refreshSessions` finishes on first paint — will
verify during plan execution.