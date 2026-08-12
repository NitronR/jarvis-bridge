# Steer button missing for Claude — root cause found (no code changed yet)

- **Date:** 2026-08-09
- **Session ID:** c4ac3e8f-8cdc-4732-95ad-7949678e87d9

## Summary

User asked (1) for a status check of the `steer` feature, then (2) why the Steer
button doesn't show for Claude despite Claude "supporting steer," with a request to
compare our implementation against reference projects in `~/Desktop/opensource`
(zed, openclaw, happy, claude-agent-acp, claude-code-acp, acp-ui, agentrq, codeg,
openclaw, opencode). Debugged with `superpowers:systematic-debugging`. This session
was investigation/comparison only — no code was changed.

## Part 1 — Steer feature status (as implemented)

Full stack confirmed present and tested end-to-end:
- Capability detection: `src/agent/acp/index.ts:42,170-176` — checks for ACP
  extension key `"jarvis-bridge/steer"` in the `initialize` response's
  `agentCapabilities.extensions`.
- Session method: `AcpAgentSession.steer()` at `src/agent/acp/index.ts:991-1007`.
- HTTP route: `POST /chat/steer` at `src/server.ts:381-395`.
- Frontend: `Composer.tsx` Steer toggle (busy-only, `steerSupported`-gated),
  `useChat.ts:258-261` `sendSteer`, `steer-ack` patch handling in `Timeline.tsx`/
  `ChatPanel.tsx:235-237` (toast on accept/reject).
- Backend/frontend test coverage exists and passes (`server.test.ts:884`,
  `acp/index.test.ts:40`, `Composer.test.tsx:137,263-276`).

## Part 2 — Root cause: why Claude never shows the button

`capabilities.steer` requires the connected agent to advertise
`agentCapabilities.extensions["jarvis-bridge/steer"]` in its ACP `initialize`
response. This is a **jarvis_bridge-invented extension key with no real
implementation anywhere** — confirmed by reading
`~/Desktop/opensource/claude-agent-acp/src/acp-agent.ts:1066-1094` in full: the
real `InitializeResponse.agentCapabilities` object has no `extensions` field at
all. Same story for opencode. `docs/agent-claude-code.md:102` already documented
this absence correctly via a live probe — it was never wrong, just incomplete
about what Claude offers instead.

What Claude actually advertises is `_meta.claudeCode.promptQueueing: true`
(`acp-agent.ts:1070-1072`), a real, working capability. jarvis_bridge already reads
it into `capabilities.promptQueueing` (`src/agent/acp/index.ts:174`) and even has
server-side plumbing that uses it: `AcpAgentSession.sendMessage()`
(`index.ts:848-866`) will queue-and-wait on `turnQueue` if called while
`ctx.busy` and `promptQueueing` is advertised. But the frontend's **"Queue"**
button (distinct from "Steer") never exercises this live path — `useChat.ts`'s
`enqueueMessage` (`useChat.ts:197-233`) holds messages purely client-side and only
sends after `ctx.state.busy` goes false. So the one real mid-turn capability Claude
offers is currently unused for actual live steering.

## Part 3 — How reference projects implement "steer"

Checked `zed`, `openclaw`, `happy` in `~/Desktop/opensource`. None use a bespoke
wire-level "steer" RPC method:

- **Zed** (`crates/agent/src/thread.rs:1230-1234,3012-3020`,
  `crates/agent_ui/src/conversation_view/{thread_view,message_queue}.rs`):
  "steer" is a client-side UX concept on top of the standard queued-prompt flow.
  The UI flags a queued message `steer: true`; the agent's own turn loop checks an
  `end_turn_at_next_boundary` flag and ends the current turn at the next
  message/tool-call boundary (instead of running to completion), then the queued
  message becomes the next turn. No special protocol method — just a flag that
  changes *when* the turn ends.
- **openclaw** (`ui/src/lib/chat/commands.ts:158`, `follow-up-mode.ts`): "steer" is
  one mode of a generic `QueueMode`, literally described as "Inject a message into
  the active run" — same pattern, a queueing mode, not a distinct RPC.
- **happy** (`packages/happy-wire/src/rigMetadata.ts:63`): exposes `steering:
  boolean` as a capability flag reported by the underlying CLI/SDK itself — a real
  agent-reported capability, not a bridge-invented extension.

Industry pattern: **steer = queueing + "end turn early" semantics**, built on
capabilities the agent already advertises (like `promptQueueing`), not a custom
extension the agent must separately implement.

## Key decision / conclusion

The current `steer` feature (extension-key detection, `/chat/steer` route,
`STEER_EXTENSION_KEY` RPC call) is dead code against every real backend — built
speculatively ahead of any agent implementing it, and none ever did. Fixing the
missing button isn't "make Claude advertise the extension" — it requires
re-scoping Steer to ride on `promptQueueing` (which Claude already has), with true
mid-turn injection, closer to Zed's "end turn at next boundary" model, rather than
the current separate `sendSteer`/`/chat/steer` path.

No implementation decision was made yet — user was asked to choose between:
(a) a quick repoint of the `steer` capability check to `promptQueueing`, or
(b) a fuller Zed-style redesign (end-turn-at-boundary + real mid-turn injection).

## Files modified

None — investigation only.

## Follow-up / next steps

1. Decide quick-repoint vs. full redesign (b likely warrants
   `superpowers:brainstorming` + `writing-plans` given it changes wire semantics
   and touches backend + frontend).
2. Once decided, update `docs/agent-claude-code.md` (§ capability table around
   line 99-102) and `docs/acp-notes.md` to document `promptQueueing` as the real
   steering mechanism, not just note the extension-key absence.
3. If redesigned Zed-style, the existing `/chat/steer` route, `STEER_EXTENSION_KEY`,
   and `AcpAgentSession.steer()` become dead code to remove rather than keep
   alongside the new path.
