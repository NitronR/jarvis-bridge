# Usage-refresh "session not found" — cwd-drift fix

Date: 2026-07-21
Session ID: (jarvis_bridge assistant session, no external tracking ID)

## Summary

User reported: clicking the "refresh usage" button in the chat panel for session
`aecd801d-255d-46c5-9aa1-1df58091c2b2` showed "Usage refresh failed: session not found",
even though the chat itself loaded and displayed history fine.

### Investigation (systematic-debugging)

- Traced the error string to `GET /chat/usage` in `src/server.ts`, which 404s when
  `resolveSessionEntry()` can't find the session's owning backend.
- `resolveSessionEntry` delegated straight to `registry.findSession(sessionId)`, which fans out
  across backend profiles and, per profile, calls `pool.listSessions()` — which only inspects
  backend instances already spawned for a given cwd, and (inside
  `AcpAgentBackend.listSessions()`) filters `session/list` results to an **exact cwd match**
  against that instance's own spawn cwd.
- Inspected `~/.jarvis-bridge/session_metadata.json`: this session's persisted cwd was
  `/Users/bhanu-mac/Desktop/Projects/jarvis_bridge/` (the main repo).
- Inspected Claude's own project storage (`~/.claude/projects/`): the session's `.jsonl` file
  lives under the project-dir encoding for
  `/Users/bhanu-mac/Desktop/Projects/jarvis_bridge/.claude/worktrees/chat-redesign` — a git
  worktree, confirmed still present and locked via `git worktree list`.
- Conclusion: the agent used a worktree-entering tool (`EnterWorktree`) mid-conversation, so
  Claude's own record of this session's cwd diverged from what Jarvis Bridge persisted at
  session-creation time. `findSession`'s exact-cwd-match filter then permanently lost track of
  the session for any endpoint that goes through `resolveSessionEntry`.
- `/chat/init` doesn't hit this because it resumes via `session/load`, which looks a session up
  by ID, not cwd — and already has a fallback (persisted cwd + default backend) for exactly the
  "ownership unknown" case, added in an earlier fix (2026-07-14, see `docs/acp-notes.md`).
  `resolveSessionEntry` (backing `/chat/usage`, `/chat/model`, auto-approve, steer, fork) never
  got that same fallback.

## Decision / fix

Gave `resolveSessionEntry` (`src/server.ts`) the identical fallback `/chat/init` already had:
when `registry.findSession()` misses, fall back to `sessionConfig.getSessionCwd(sessionId)` +
`registry.getDefaultBackend(cwd)`, returning a synthetic `RegistrySessionEntry`. This is a
best-effort "assume the default backend" guess, same as `/chat/init` already makes — acceptable
because `queryUsage()` doesn't even take a `sessionId` (it's account-level CLI usage keyed by
cwd/env), and the other affected endpoints (`getSessionModels`, auto-approve overrides, steer,
fork) all degrade gracefully (return `supported:false`/no-op) rather than crash if the sessionId
turns out to be genuinely bogus.

Wrote a regression test (`src/server.test.ts`, "GET /chat/usage falls back to the persisted
session cwd when findSession's cwd-based index misses the session") that constructs a registry
whose `findSession` always returns null (simulating the cwd-index miss) and confirms
`/chat/usage` still resolves via the persisted cwd. Verified TDD-style: confirmed it fails
(404) with the fallback temporarily disabled, then passes (200) with the real fix.

Documented the gotcha in `docs/acp-notes.md` under a new subsection so this doesn't get
silently reintroduced if `resolveSessionEntry` is ever refactored.

## Files modified

- `src/server.ts` — `resolveSessionEntry()` gained a `sessionConfig` parameter and the
  persisted-cwd fallback; all 7 call sites updated to pass `opts.sessionConfig`.
- `src/server.test.ts` — new regression test.
- `docs/acp-notes.md` — new subsection documenting the gotcha.

## Follow-up / next steps

- Not done in this session: committing the change (user hasn't asked yet).
- Worth a passing thought: the `.claude/worktrees/chat-redesign` worktree is still locked and
  present on disk — not touched or evaluated for cleanup as part of this fix.
- No further action needed on the fallback's "assume default backend" heuristic unless a user
  actually runs multiple non-default backend profiles concurrently and hits a case where the
  guess is wrong (untested edge case, but same pre-existing risk `/chat/init` already carries).
