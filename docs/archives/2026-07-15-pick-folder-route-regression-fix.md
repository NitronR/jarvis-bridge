# Folder picker regression: `/chat/pick-folder` route was a dead stub

**Date:** 2026-07-15
**Session ID:** `2491cbcd-dac6-4c2f-9662-b840a93b0eaf`

## Summary of work done

User reported "Open Folder" returning "folder picker not supported on this platform"
on macOS, calling it a regression since Mac support had already been added. Used
`superpowers:systematic-debugging` to trace it.

**Root cause:** `POST /chat/pick-folder` in `src/server.ts` was a hardcoded stub that
always returned `501`, regardless of `process.platform`. `src/pickFolder.ts`
(`pickFolderNative`, a real `osascript -e 'choose folder'` implementation) existed in
the tree but was never called from anywhere — dead code.

**The real history (found via `docs/archives/2026-07-13-workspace-picker-implementation.md`):**
this feature *was* fully implemented and working on 2026-07-13 — backend route wired to
`pickFolderNative`, frontend "+ New in..." button, the works. But per explicit user
instruction that day, none of it was committed. That session ended with the working
tree dirty. A later commit, `75317a1` ("feat: persistent session metadata, multi-backend
workspace routing, ChatsDrawer, WorkspacesDrawer"), evidently swept up parts of that
uncommitted work — `src/pickFolder.ts`, `src/pickFolder.test.ts`, and the frontend
`startNewChatInWorkspace`/"+ New in..." pieces all made it in — but the `src/server.ts`
route wiring did not; only the pre-existing 501 stub got committed. The 2026-07-13 note
also flagged a concurrent, unrelated session editing `server.ts`/`ChatContext.tsx` at
the same time, which is the likely mechanism for the drop. So this genuinely was a
regression (feature worked, then silently reverted to a stub), just not in the way it
first appeared (it was never "released" in a strict sense — it just quietly vanished
before ever being committed).

**Fix:** re-wired `/chat/pick-folder` in `src/server.ts`:
- Added `pickFolder?: PickFolderFn` to `CreateServerOptions` (defaults to
  `pickFolderNative`), matching the existing injectable-dependency pattern used for
  `sessionConfig`.
- Route now checks `process.platform !== "darwin"` → `501`; otherwise parses
  `{ initialCwd? }` via a new `PickFolderBodySchema` and calls `pickFolder(initialCwd)`,
  returning `{ ok, cancelled, cwd }` — matching what `ChatPanel.tsx`'s `onPickFolder`
  already expected (that frontend code was untouched and already correct).

Added 3 tests to `src/server.test.ts` (`withPlatform` helper using
`Object.defineProperty(process, "platform", ...)` to force darwin/non-darwin
deterministically): 501 + `pickFolder` not invoked off-macOS, wiring/`initialCwd`
passthrough on macOS, and the cancel path. All 39 server tests and full 181-test backend
suite pass; `tsc --noEmit` clean.

## Key decisions made

- Diverged from the 2026-07-13 session's fix for testability: that session's review
  caught the platform guard blocking injected fakes and worked around it with
  `pickFolder === pickFolderNative && process.platform !== "darwin"` in the route
  itself. This session instead kept the route logic as a plain `process.platform`
  check and made tests override `process.platform` directly via
  `Object.defineProperty`. Reasoning: the compound condition bakes a test-detection
  smell into production code (route logic branching on "is this the default
  implementation or a fake"); overriding `process.platform` in the test is a more
  standard technique and keeps the route free of test-only conditionals.
- Did not trigger the real `osascript` dialog non-interactively (would pop a live
  Finder picker and block waiting on human input) — left as a manual verification
  step for the user instead.

## Files modified

- `src/server.ts` — `CreateServerOptions.pickFolder`, `/chat/pick-folder` route body,
  `PickFolderBodySchema`.
- `src/server.test.ts` — `withServer` `pickFolder` passthrough, `withPlatform` helper,
  3 new tests.

(`src/pickFolder.ts`, `src/pickFolder.test.ts`, and the frontend pieces were already
correct/committed and untouched by this session.)

## Follow-up / next steps

1. User should manually click "Open Folder" in the running app to confirm the native
   Finder dialog appears, returns a path, and Cancel is a no-op — this can't be
   automated non-interactively.
2. Nothing was committed as part of this session (per standing instruction: only commit
   when explicitly asked). `src/server.ts`/`src/server.test.ts` changes sit alongside
   other unrelated pending changes already in the working tree (e.g. a `/chat/usage`
   route) — review the combined diff before committing.
3. If this "uncommitted work silently dropped during a later unrelated commit" pattern
   recurs, it may be worth treating same-day uncommitted work as higher-risk and
   committing incrementally rather than batching multiple features into one later
   commit.
