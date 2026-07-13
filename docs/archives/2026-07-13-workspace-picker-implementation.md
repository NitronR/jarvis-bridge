# Workspace Picker Implementation

**Date:** 2026-07-13
**Session ID:** 4ea9286f-7487-457e-8a2a-b950474b9213

## Summary

Implemented "open a new chat rooted at an arbitrary workspace folder,"
triggered via a native macOS folder dialog. Went through brainstorming →
spec → plan → subagent-driven execution (partially — see decisions below).

Backend: finished the pre-existing but unimplemented `POST
/chat/pick-folder` stub (`src/server.ts`) by shelling out to `osascript -e
'choose folder'` via a new `src/pickFolder.ts` module, injectable through
`CreateServerOptions.pickFolder` for testability. Frontend: added a
"+ New in..." button to `ChatPanel`'s header, gated on the
`customWorkingDirectory` capability, wired through a new
`useChat.startNewChatInWorkspace(cwd)` and a `cwd` param added to
`ChatContext.init()`, both of which feed the already-existing
`GET /chat/init?cwd=` endpoint.

All 4 planned tasks are complete. **Nothing was committed** — the user
explicitly asked to work without a worktree and without commits during this
execution, so all changes sit uncommitted in the working tree.

## Key decisions

1. **Design pivot mid-brainstorm:** the original design (before user
   approval) was a custom server-side directory-listing endpoint +
   in-app breadcrumb modal, reasoning that a browser can't get a real
   filesystem path from a folder dialog. Mid-planning, discovered
   `src/server.ts` already had a stub `POST /chat/pick-folder` (always
   501) and the archived `docs/archives/implementation/03-http-api.md`
   already documented its intended contract as a **native macOS dialog**.
   Re-confirmed with the user and pivoted to finishing that stub instead —
   simpler, no new directory-listing route, matches pre-existing intent.
2. Button UX: "+ New in..." stays visible but disabled when
   `customWorkingDirectory` is unsupported (matches the existing
   Fork/Steer/AA button convention), rather than being hidden.
3. `initialCwd` pre-seeding uses `localStorage["jarvis.lastWorkspace"]`
   (matches the existing `jarvis.quickPhrases` key convention in
   `SettingsPanel.tsx`).
4. Per user's explicit, standing instruction (never auto-create worktrees):
   asked before using subagent-driven-development's default worktree
   isolation. User chose to continue in the current workspace, no worktree,
   **and no commits** during execution.
5. **Mid-execution, user asked to stop using subagents/reviews** for the
   remaining tasks ("do it fast... directly implement remaining stuff").
   Tasks 1 and 2 went through the full subagent-implementer +
   subagent-reviewer loop; Tasks 3 and 4 were implemented directly by the
   controller (this session) with no subagent dispatch and no separate
   review pass.

## Concurrent-session collision (handled)

Discovered partway through execution that another, unrelated session had
uncommitted changes in the same working tree (no worktree isolation,
per decision above) touching the exact files this plan needed:
- `frontend/src/state/ChatContext.tsx` — added a `loading` flag, wrapping
  `init()`'s body in try/finally. **Directly collided** with this plan's
  edit to the same function.
- `frontend/src/components/ChatPanel.tsx`, `src/server.ts` — smaller,
  non-overlapping changes (a `loading` prop passthrough; a
  `registry.findSession`-based backend-resolution change to `/chat/init`).

Surfaced this to the user mid-execution rather than proceeding blind. User's
call: adapt this plan's edits around the files *as they currently stood*
(i.e., layer the `cwd` param into `init()` around the already-present
`loading` try/finally) rather than pausing or switching to a worktree. Both
features now coexist uncommitted in the same files — reviewed before
committing is a listed next step below.

## Review findings

- **Task 1** (`src/pickFolder.ts` + tests): reviewed clean, no findings.
- **Task 2** (`POST /chat/pick-folder` route): review caught one real
  Important-severity bug — the `process.platform !== "darwin"` guard fired
  *before* checking whether a test had injected a fake `pickFolder`,
  meaning the 4 new route tests would have silently failed on non-macOS CI
  despite being written to be platform-independent. Fixed directly: guard
  now reads `pickFolder === pickFolderNative && process.platform !==
  "darwin"`. Re-verified: 30/30 server tests + backend typecheck pass.
- Tasks 3–4: no separate review pass (see decision #5). Verified directly:
  4/4 `useChat` tests, full frontend suite 18 files / 73 tests pass.

## Incidental findings (pre-existing, not caused by this session)

- `jsdom`'s `localStorage` is nonfunctional in this repo's current vitest
  environment (`typeof localStorage.getItem === "undefined"`, confirmed via
  a throwaway test) — worked around by stubbing `localStorage` in the new
  `ChatPanel.test.tsx` describe block rather than fixing the environment
  globally. Worth a real fix (e.g. `environmentOptions: { jsdom: { url:
  "http://localhost" } }` in `vite.config.ts`) if more component tests
  start touching `localStorage`.
- `ChatPanel.test.tsx`'s first ("renders the title...") test causes an
  unmocked `fetch("/chat/init")` call that jsdom can't resolve to an
  absolute URL, producing an intermittent "Unhandled Rejection" in later
  tests in the same file. Confirmed pre-existing by running the file's
  original (pre-session) version standalone — same failure reproduces.
  Not fixed as part of this session (out of scope).
- `src/agent/acp/jsonrpc.test.ts` has a pre-existing failing test
  (`onRequest handler replies with the handler's result`), unrelated to
  this feature — confirmed via `git diff` showing zero uncommitted changes
  to that file or its source.

## Files modified (all uncommitted)

- `src/pickFolder.ts` (new)
- `src/pickFolder.test.ts` (new)
- `src/server.ts` (`CreateServerOptions.pickFolder`, `/chat/pick-folder`
  route, `PickFolderBodySchema`)
- `src/server.test.ts` (`withServer` `pickFolder` passthrough + 4 new tests)
- `frontend/src/state/ChatContext.tsx` (`init(sessionId, cwd)`)
- `frontend/src/state/useChat.ts` (`startNewChatInWorkspace`)
- `frontend/src/state/useChat.test.tsx` (+1 test)
- `frontend/src/components/ChatPanel.tsx` ("+ New in..." button)
- `frontend/src/components/ChatPanel.test.tsx` (+2 tests, incl. a
  `localStorage` stub)
- `docs/superpowers/specs/2026-07-13-workspace-picker-design.md` (spec)
- `docs/superpowers/plans/2026-07-13-workspace-picker.md` (plan)
- `.superpowers/sdd/progress.md` (gitignored SDD ledger, not part of the
  repo)

## Follow-up / next steps

1. Review the combined uncommitted diff in `ChatContext.tsx`/
   `ChatPanel.tsx`/`server.ts` before committing anything — two unrelated
   features' changes are interleaved in the same files.
2. Manually verify the native Finder dialog end-to-end (can't be automated):
   click "+ New in...", confirm the dialog appears, pick a folder, confirm
   title/transcript update; reopen and confirm it starts pre-navigated to
   the last pick; confirm Cancel is a no-op.
3. Decide on commit grouping/messages — nothing was committed during this
   session.
4. Optional cleanup: fix jsdom's `localStorage` support at the vitest-config
   level instead of per-test stubbing, and look into the pre-existing
   `ChatPanel.test.tsx` cross-test unhandled-rejection flakiness.
