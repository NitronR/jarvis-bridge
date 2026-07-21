# Agent stream reconnect — code review follow-up

**Date:** 2026-07-18, ~10:58 IST
**Session ID:** 8d25ba86-a786-4a00-9163-705ba59ee4f7

## Summary

Continuation of the agent-stream-reconnect feature work (design → plan →
subagent-driven implementation → whole-branch review, all completed in a
prior session — see the plan/spec under `docs/superpowers/` and the SDD
progress ledger at `.superpowers/sdd/progress.md`). By the time this session
picked back up, the user had already reviewed and committed that work
themselves as `6d1b01f` ("feat: agent stream reconnect — activeTurn
buffering, GET /chat/stream, disconnect-safe turns"), and two more unrelated
commits (`bbec1b8`, `fc5e539`, tool-call status indicators) had landed on
top of it.

The session's actual work: the user asked for a fresh, independent
code-review pass over `6d1b01f`. Repeated attempts to dispatch the review
via parallel subagents (the `code-review` skill's normal 8-finder-angle
process) were blocked — first by API session-limit/classifier-unavailability
errors, then by a direct tool-use rejection. Per explicit user confirmation
("Review commit 6d1b01f" via AskUserQuestion), the review was done directly
in this session instead of via subagents: read the full commit diff plus
the current state of the touched files, traced the `activeTurn`/`emit()`
buffering, the `done`-sentinel drain loop, `getActiveTurn()`'s token-based
attach/detach, the `/chat/init` liveTurn branch, `/chat/stream`'s
replay-then-attach race-freedom, and the frontend `sendingRef`/`detachOnly`
navigation logic.

## Key findings (reported via ReportFindings, no fixes applied yet)

1. **Critical (CONFIRMED) — `frontend/src/state/useChat.ts:152`**: `cancel()`
   (the Stop button) never resets `sendingRef.current` to `false`. Aborting
   the SSE fetch (`sseRef.current?.abort()`) suppresses `sendMessage`'s own
   `onDone`/`onError` — the only other place `sendingRef` gets reset —
   because `fetchSSE`'s `abort()` sets its internal `aborted` flag before
   calling `controller.abort()`, and the resulting rejection is swallowed by
   `if (aborted) return;` in `frontend/src/api/client.ts`. Net effect: after
   *any* Stop-button use, `sendingRef` is stuck `true`. If the user then
   switches to a different session with its own live background turn
   (reattach-only — `busy` set purely from watching, not sending) and
   navigates away again, the stale `sendingRef` makes `switchSession` /
   `startNewChat` / `startNewChatInWorkspace` wrongly issue a **real**
   `/chat/cancel`, killing a turn this tab never initiated. This reintroduces
   the exact bug class the prior session's final-whole-branch-review round-2
   fix (`sendingRef`) was built to prevent, via a path that fix didn't cover.
   **Fix (not yet applied):** add `sendingRef.current = false;` inside
   `cancel()`.

2. **Minor (CONFIRMED) — `src/agent/acp/index.ts:846`**: `SendMessageOptions.signal`
   and its abort-listener wiring in `sendMessage()` are now dead code. The
   only production caller (`src/server.ts:220`, `/chat/send`) stopped passing
   `signal` as part of `6d1b01f` itself (removing the cancel-on-disconnect
   behavior is the whole point of the feature). No test exercises it either.
   Not a correctness bug, but a future reader could mistake it for
   load-bearing cancellation plumbing. Candidate for deletion or a
   "vestigial" comment.

Everything else traced through review held up correctly — no new issues
found beyond what the prior session's two whole-branch review rounds already
caught and fixed.

## Decisions

- Do the review inline (read diff + files directly) rather than via
  subagents, since subagent dispatch was blocked twice in a row (infra
  errors, then a direct tool-use denial) — this was a pragmatic fallback,
  not a change in default process.
- No code changes made this session — findings were reported, not fixed.
  The user had not yet said whether to fix now or fold into the next commit.
- No `docs/` update made this session (nothing about current system
  behavior changed — this was a review-only pass over already-committed
  code).

## Files modified

None. This session was read-only (review pass) plus this archive note.

## Follow-up / next steps

1. Fix `cancel()` in `frontend/src/state/useChat.ts` to reset
   `sendingRef.current = false`, with a regression test: cancel a send →
   reattach to a different session's background turn → switch away again →
   assert no real `/chat/cancel` is sent.
2. Decide whether to delete the now-dead `signal`/`onAbort` plumbing in
   `src/agent/acp/index.ts` (and `SendMessageOptions.signal` in
   `src/agent/types.ts`, and the mirrored check in
   `test/fixtures/fakeBackend.ts`) or leave a comment marking it vestigial.
3. Land the above as a follow-up commit on top of `6d1b01f` (or amend, per
   the user's call) before returning to the newer tool-call-status-indicator
   work (`bbec1b8`, `fc5e539`) that's already landed on `main`.

## Resolved (same date, continuation session)

Both findings were fixed and landed as `1c7b7e5` ("fix: reset sendingRef on
cancel, drop dead SendMessageOptions.signal"):

1. `cancel()` now sets `sendingRef.current = false` alongside its existing
   `sseRef`/`busy` teardown. Added a regression test in
   `frontend/src/state/useChat.test.tsx` ("cancel() resets sendingRef so a
   later reattach-only switch does not send a real cancel") — verified it
   fails without the fix (asserts no `/chat/cancel` call, which fired
   without the reset) and passes with it.
2. Chose deletion over a vestigial comment for the dead `signal` plumbing:
   removed `SendMessageOptions.signal` (`src/agent/types.ts`), the
   `onAbort`/`addEventListener`/`removeEventListener` wiring in
   `AcpAgentSession.sendMessage()` (`src/agent/acp/index.ts`), and the
   mirrored `opts?.signal?.aborted` check in `test/fixtures/fakeBackend.ts`.
   Confirmed via grep that no caller (production or test) passes `signal`
   into `sendMessage()` post-`6d1b01f`.

Verification: full backend suite (187 tests, `npm test`) and frontend suite
(165 tests, `vitest run`) pass; `tsc --noEmit` clean on both sides. The 3
`ChatContext.test.tsx` unhandled-rejection errors seen in the frontend run
are pre-existing (reproduced identically on `main` before this session's
changes via `git stash`) — unrelated mock-fetch URL issue, not a regression.
