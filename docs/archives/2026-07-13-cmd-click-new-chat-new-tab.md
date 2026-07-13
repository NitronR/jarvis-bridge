# Cmd/Ctrl-Click "+ New" Opens a New Chat in a New Tab

**Date:** 2026-07-13
**Session ID:** `74070857-ca86-4658-b570-96ab76be1e19`

## Summary of work done

Implemented the requested behavior: cmd-clicking (or ctrl-clicking) the "+ New" button in
`ChatPanel` now opens a brand-new chat in a new browser tab, pre-seeded with the *current*
chat's workspace (`cwd`), ACP backend, and model — rather than starting a new chat in place
(which resets to the default workspace). A plain click is unchanged.

The backend-side plumbing for this (`backend`/`model` query params on `GET /chat/init`,
`backend.name` in the response, carrying a requested model onto a freshly created session)
was already present in the working tree from unrelated in-progress work, with a comment
explicitly anticipating "a same backend/model new-tab" — so this session only had to wire
the frontend:

1. `frontend/src/state/ChatContext.tsx` — `init()` now accepts `backend`/`model` and threads
   them into the `/chat/init` query string; the response's `backend.name` is stored into
   `state.backendName` (a field that existed on `ChatState` but was never populated). On
   mount, if there's no `sessionId` in the URL, a new `getInitParamsFromUrl()` reads
   `cwd`/`backend`/`model` from the URL to seed a fresh session — this is what a cmd-click-
   opened tab lands on. `setSessionIdInUrl()` now also strips `cwd`/`backend`/`model` from
   the URL once consumed, so they're a one-shot handoff, not a durable part of the URL (a
   later reload of that tab falls back to plain `sessionId`-based resume).
2. `frontend/src/state/useChat.ts` — new `openNewChatInNewTab()` builds a URL from
   `ctx.state.cwd`/`backendName`/`currentModel` and calls
   `window.open(url, "_blank", "noopener,noreferrer")`.
3. `frontend/src/components/ChatPanel.tsx` — the "+ New" button's `onClick` now checks
   `e.metaKey || e.ctrlKey`; if held, calls `openNewChatInNewTab()` instead of
   `startNewChat()`.

Followed TDD throughout (RED confirmed for each new test before implementing, then GREEN),
per the project's `superpowers:test-driven-development` skill requirement.

## Key decisions made

- Scoped to the single "+ New" button, not "+ New in..." (which already has its own distinct
  folder-picker flow) — the user's request was specifically about the plain new-chat action.
- New-tab URL carries `cwd`/`backend`/`model` as one-shot query params rather than, say, a
  new dedicated endpoint — reuses the `/chat/init` support that already existed, and matches
  the existing `sessionId`-in-URL pattern the app already uses for resume-on-reload.
- Transient params are actively stripped from the URL after being consumed (rather than left
  sitting in the address bar) so a later manual reload of that same tab behaves like any other
  chat tab (resume by `sessionId`), not like a repeat "new chat with the same params" action.

## Files modified

- `frontend/src/state/ChatContext.tsx` — `init()` signature/behavior, `getInitParamsFromUrl()`,
  `backendName` population, URL param stripping.
- `frontend/src/state/useChat.ts` — new `openNewChatInNewTab()`.
- `frontend/src/components/ChatPanel.tsx` — cmd/ctrl-click branch on the "+ New" button.
- `frontend/src/state/ChatContext.test.tsx`, `frontend/src/state/useChat.test.tsx`,
  `frontend/src/components/ChatPanel.test.tsx` — new tests for all of the above (TDD).

Frontend: 107/107 individual tests pass. Vitest reports one test *file*
(`ChatPanel.test.tsx`) as failed only because of a pre-existing, unrelated unhandled-promise-
rejection: two tests there don't mock `fetchJSON`, so Node's real `fetch()` throws on the
relative `/chat/init` URL. That `try { } finally { }` (no `catch`) in `ChatContext.init()`
predates this session — confirmed via `git diff` against HEAD before making any edits — and
was not introduced or touched here.

## Follow-up tasks / next steps

1. Manual browser verification of the actual cmd-click → new-tab → same workspace/backend/
   model flow has not been done yet (only unit-tested). Asked the user whether to spin up
   `npm run dev:web` for this now, given other sessions are actively running against the same
   working tree; awaiting their answer.
2. The pre-existing unhandled-rejection issue in `ChatContext.init()` (no `catch`) is real but
   out of scope for this task — flagged to the user, not fixed.
3. Repo-wide `tsc --noEmit` still fails for reasons unrelated to this change (missing CSS-
   module type declarations, an `ApprovalRequestPatch` narrowing issue, a vitest `MockInstance`
   version mismatch) — pre-existing, not touched.
4. Heavy concurrent activity was observed and confirmed intentional by the user (multiple
   sessions they're driving in parallel): a `turnCounts` (session message count) feature and
   per-session API traffic logging both landed in `ChatContext.tsx`/`AGENTS.md` mid-session,
   layered cleanly on top of this session's edits with no apparent loss of either side's work.
