# 2026-07-15 — Real elicitation handling (`AskUserQuestion` support)

## What changed

Claude's `AskUserQuestion` tool (and any other ACP `elicitation/create` request in
`mode: "form"`) previously always got auto-cancelled — `src/agent/acp/index.ts`'s handler
unconditionally replied `{action: "cancel"}`. This was a deliberate Phase-1 deferral
(`docs/claude-acp-future-phases.md`, `docs/agent-claude-code.md` §8) confirmed safe
because the model recovers gracefully rather than hanging — but the user never actually
got asked or got to answer.

This session wired the request through to the UI end-to-end:

- **`src/agent/types.ts`**: new `ElicitationField` type (protocol-generic — `select` /
  `multi-select` / `text`, not shaped around `AskUserQuestion` specifically) and a new
  `elicitation-request` `ChatPatch` variant. `AgentSession.resolveElicitation?()` added
  alongside the existing `resolveApproval?()`.
- **`src/agent/acp/mapping.ts`**: `elicitationSchemaToFields()` normalizes an ACP
  `requestedSchema` into `ElicitationField[]` — `oneOf` → `select`, `type: "array"` with
  `items.anyOf` → `multi-select`, anything else → `text` (generic fallback, nothing
  dropped).
- **`src/agent/acp/index.ts`**: `elicitation/create` now checks `mode === "form"` and has
  a live session context before routing to a new `routeElicitationToUI()` (mirrors the
  existing `routeApprovalToUI` pattern) instead of auto-cancelling. Any other `mode` (MCP
  dialogs, `refusal_fallback_prompt`) still hits the defensive `{action: "cancel"}`
  fallback — those remain unimplemented, not just deferred-and-safe. Pending elicitations
  are tracked per-session (`pendingElicitations` map) and resolved via
  `AcpAgentSession.resolveElicitation()`; dangling ones are auto-cancelled on session
  close/exit, same as pending approvals.
- **`src/server.ts`**: new `POST /chat/elicitation` route (`{sessionId, requestId, action,
  content}`) resolving to the session, 404 if the session is unknown, 409 if there's no
  matching pending elicitation.
- **Frontend**: `frontend/src/api/types.ts` mirrors the `ElicitationField`/`ChatPatch`
  types; `useChat.ts` adds `resolveElicitation()`; `Timeline`/`Message`/`Transcript` thread
  an `onElicitation` prop down to where patches are consumed; new
  `frontend/src/components/ElicitationModal.tsx` renders the fields (radio for `select`,
  checkboxes for `multi-select`, text input for `text`) with Submit (→ `accept` +
  collected `content`) and Skip (→ `decline`) actions, wired into `ChatPanel.tsx` the same
  way `ApprovalModal` already was.

## Bug fixed along the way

`AcpAgentSession` didn't expose a `resolveApproval()` passthrough to
`AcpAgentBackend.resolveApproval()` — only the backend-level method existed. Added the
session-level wrapper (mirroring the new `resolveElicitation()` one) while wiring this up.

## Verification

- Backend: `tsc --noEmit` clean; `node --test` over `src/agent/acp/index.test.ts`,
  `src/agent/acp/mapping.test.ts`, `src/server.test.ts` — 83 passed, 0 failed (includes a
  new `POST /chat/elicitation forwards action/content to the session` case).
- Frontend: `vitest run` over `ElicitationModal.test.tsx`, `ChatPanel.test.tsx`,
  `useChat.test.tsx` — 13 passed, 0 failed.

## Still deferred

MCP-server-initiated elicitation dialogs and the opt-in `refusal_fallback_prompt` dialog
(retry-on-fallback-model after a refusal) use the same `elicitation/create` request but a
different `mode`/shape that hasn't been probed against a live Claude backend — see
`docs/claude-acp-future-phases.md`.

---

## Follow-up (same day): live-test bug fix — Timeline re-emitting stale requests

**Session:** `claude_code_session_id=6c276edb-b209-4ccb-97e5-748bad463967`

After the above shipped, live-testing against a real Claude backend surfaced a real bug:
the user reported the same `AskUserQuestion` prompt reappearing 2-3 times even after
answering it, having only restarted the chat session (not the gateway process).

**Root cause:** `frontend/src/components/Timeline.tsx`'s `buildTimelineState()` re-walks
the entire `patches` array from scratch on every recompute (a `useMemo` keyed on
`patches`, which grows by one entry per streamed delta). Rendering bubbles from scratch
each time is fine, but `approval-request`/`elicitation-request`/`steer-ack`/
`images-skipped` also fire an `emit.onXxx?.(p)` side-effect callback while being walked —
with no guard, that callback refired on **every subsequent recompute**, not just the first
time. So once a user answered an `elicitation-request` (closing the modal), any later
patch in the same turn (tool result, trailing assistant text) re-walked the array,
re-encountered the already-answered request, and reopened the modal — 2-3 times,
matching the reported symptom exactly.

**Fix:** `Timeline` now holds a ref-based `Set<ChatPatch>` (`emittedRef`, deduping by patch
object identity, stable since historical patches are never mutated/recreated) and only
invokes each one-shot callback once per patch, no matter how many more times the
surrounding array is recomputed. Applies uniformly to all four one-shot patch types
(`approval-request`, `elicitation-request`, `steer-ack`, `images-skipped`), since they all
shared the same architectural flaw — `steer-ack`/`images-skipped` would have caused
duplicate toasts under the same conditions, just less noticeably.

### Files modified
- `frontend/src/components/Timeline.tsx` — `emittedRef` guard in `buildTimelineState()`.
- `frontend/src/components/Timeline.test.tsx` — two new regression tests simulating patches
  continuing to stream in after an elicitation/approval request is answered.
- `docs/acp-notes.md` — new pitfall section ("Frontend: one-shot request patches... must be
  deduped by identity") so a future one-shot `ChatPatch` type doesn't reintroduce this.

### Verification
- Frontend: full `vitest run` — 24 files, 152 tests passed (3 pre-existing unrelated
  unhandled-rejection warnings in `ChatContext.test.tsx`'s URL mocking, not caused by this
  change).
- Manually confirmed fixed by the user after restarting only the chat session (frontend
  hot-reloads via Vite; this was a frontend-only fix, no gateway restart needed).

### Next steps / open items
- Nothing else outstanding from this bug — closed.
- Broader elicitation backlog (MCP dialogs, `refusal_fallback_prompt`) still open, see
  `docs/claude-acp-future-phases.md`.
- Work is uncommitted as of this note — user has not yet asked for a commit.
