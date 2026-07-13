# 2026-07-13 — ChatsDrawer message count (session turn counts)

## Summary

Started implementing session message count display in the ChatsDrawer pop-up
chat cards. Design completed and committed; implementation partially done.

## Key decisions

- **Count type:** Total `ChatHistoryEntry` items (user + assistant turns), not
  user-only.
- **Storage:** `localStorage` under key `jarvis.turnCounts`
  (`Record<string, number>`). Survives page reloads. Self-correcting: server
  always wins on next `init()`.
- **Rendering:** `N msgs` pill in `.cardMeta` row. Count 0 or unknown → no pill.
- **Architecture:** Pure frontend. No backend changes. No wire contract expansion.
- **GC:** `pruneTurnCounts(keepIds)` runs after every `GET /chat/sessions` to
  drop entries for sessions the backend no longer reports.
- **`reset()` preserves `turnCounts`** — clearing the active session must not
  wipe counts for other sessions.

## Bug found & fixed

jsdom's `window.localStorage` is a **getter-only** property (`set: undefined`).
The common pattern `(globalThis as any).localStorage = mock` silently fails.

Fix: `Object.defineProperty(window, "localStorage", { value: mock, configurable: true, writable: true })`.

This applies to ALL localStorage mocking in the frontend test suite. Existing
`ChatsDrawer.test.tsx` localStorage tests also use the broken pattern and would
fail if run (pre-existing issue — those tests were untracked and never run before).

## Files modified

| File | Change |
|---|---|
| `frontend/src/state/ChatContext.tsx` | Added `turnCounts` to `ChatState`, `getTurnCount()`, `pruneTurnCounts()`, localStorage hydration in `useState` initializer, write-through on `init()`, `reset()` preserves counts |
| `frontend/src/state/ChatContext.test.tsx` | Added 6 tests for turnCounts: init populates, empty history, localStorage hydration, prune, reset preserves, corrupt storage. Fixed localStorage mock to use `Object.defineProperty`. |

## Not yet started

- `ChatsDrawer.tsx` — accept `getTurnCount` prop, render `.turnCount` pill
- `ChatsDrawer.module.css` — `.turnCount` class
- `ChatPanel.tsx` — wire `getTurnCount` + `pruneTurnCounts`
- `ChatsDrawer.test.tsx` — tests for turnCount rendering

## Blocking issue

Persistence test passes in isolation (`-t "init records history.length"`) but
fails when run with all tests. The `saveTurnCounts` call succeeds (debug logs
confirm `setItem` is called), but the `store` Map doesn't reflect the write.
Suspect: another test's cleanup or the `afterEach`/`finally` ordering
interferes with the mock. Needs investigation.

## Follow-up tasks

1. Debug & fix the localStorage persistence test ordering issue
2. Implement `getTurnCount` prop in `ChatsDrawer.tsx`
3. Add `.turnCount` CSS class
4. Wire `getTurnCount` + `pruneTurnCounts` in `ChatPanel.tsx`
5. Add `ChatsDrawer` turnCount rendering tests
6. Run full frontend typecheck + all tests
7. Run backend typecheck + tests (unchanged code, just verification)
