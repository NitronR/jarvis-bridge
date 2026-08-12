# ACP turn-hang investigation — stuck spinner / orange favicon

**Date:** 2026-08-09
**Session ID:** d3038809-af84-42d1-9107-9f5caa6432cd
**Updated:** 2026-08-09 (follow-up research)

## Summary

Investigated a report that session `c0e3d09e-26c6-44f4-833d-03940ceaf5b0` showed the Stop
button and an orange (busy) favicon indefinitely, even though the agent had visibly finished
responding in the transcript.

Used `superpowers:systematic-debugging` (Phase 1, root-cause-first). Findings, in order:

1. **Confirmed live against the running backend** (`curl localhost:3001/chat/init?sessionId=...`)
   that `activeTurn: true` server-side — the frontend's busy/favicon state was an accurate
   reflection of real backend state, not a rendering bug. `useFavicon.ts` and `useChat.ts` only
   clear `busy` on an SSE `"done"`/`"error"` patch, neither of which had arrived.
2. Inspected the session's buffered `activeTurn.patches` (170 patches) via the same endpoint:
   a fully-formed final assistant message, then three trailing `usage` patches, then nothing —
   no `"done"` patch was ever appended. That pins the hang to
   `AcpAgentSession.sendMessage()`'s `session/prompt` `sendRequest()` promise
   (`src/agent/acp/index.ts:908-930`) never resolving or rejecting.
3. Confirmed via `ps`/`lsof` that the underlying `claude` CLI subprocess and the
   `claude-agent-acp` bridge process were both alive and idle (not crashed, not pegged at
   100% CPU) — ruling out a crashed/hung process as the cause.
4. Found `AcpConnection.sendRequest()` (`src/agent/acp/jsonrpc.ts:143`) has no timeout — a
   silent upstream non-response hangs the promise (and the turn) forever with no self-recovery.
5. Cross-checked `~/Desktop/opensource/claude-agent-acp` (local clone of the actual bridge
   package) and traced the mechanism: `Turn.deferredSettle` intentionally holds `session/prompt`
   open while a turn's spawned background subagent (`Task` tool) is still live, so the
   subagent's output/permission-requests land inside the turn (commit `255e79b`, hardened by
   `c308283`/`ed0d121`/`293bacb` same day). The stuck session had used both a `Task` subagent
   and a plain `run_in_background` Bash command — and only `Task` subagents are meant to hold
   the turn open, so this mix is exactly the shape that can fall into an unreconciled gap.
6. Checked the ACP protocol schema directly (`@agentclientprotocol/sdk/schema/schema.json`) —
   confirmed there is no `session/status`/`session/get` polling method. The only recovery lever
   is `session/cancel` (the Stop button), same as every other ACP client.
7. Web research confirmed this is a known, unresolved, cross-repo bug class — not specific to
   jarvis_bridge: `zed#56734` (open, proposes an unmerged inactivity-timeout setting),
   `zed#53438`, `zed#55501`, `claude-agent-acp#338`, and `claude-code#59962` (which itself rolls
   up five more related reports: #44783, #48312, #55893, #58637, #59900). Even Zed, built by the
   same team as `claude-agent-acp`, has no shipped auto-recovery for this today.

## Key decisions

- Treat this as an **upstream bug**, not a jarvis_bridge defect — no code fix was made this
  session, by design (systematic-debugging: found root cause, but the actual defect lives in a
  third-party package refetched fresh via `npx` on every backend spawn, not vendored here).
- Documented the finding in `docs/` (see below) rather than papering over it, so a future
  stuck-session report is diagnosed in minutes instead of requiring a full re-investigation.
- Decided *against* a flat wall-clock timeout if a jarvis_bridge-side backstop is ever added —
  a **silence-based** timer (reset on every `emit()` call, tripped only after N minutes of zero
  patches) is safer since it won't kill a turn that's still legitimately streaming.

## Follow-up outcomes (2026-08-09)

### 1. Session recovery — `POST /chat/cancel` ✅ DONE

Session `c0e3d09e-26c6-44f4-833d-03940ceaf5b0` was successfully cancelled via
`POST /chat/cancel`. The session was recovered.

### 2. Silence-based timeout — NOT PURSUED

Decided against implementing the jarvis_bridge-side silence-based timeout backstop.
Rationale:
- The upstream `claude-agent-acp` has shipped significant fixes since the investigation
  (see "Upstream fixes in v0.66.0" below) that address the original root causes.
- The timeout would touch the AGENTS.md "don't-touch" session-lifecycle zone
  (`src/agent/acp/index.ts:890-897`), introducing risk to stable machinery.
- A real hang could not be reproduced in testing — normal prompts AND Task subagent
  prompts both resolved cleanly with `stopReason: end_turn`.

### 3. Upstream issue filing — NOT PURSUED

Decided to investigate more before filing. The theoretical Task subagent + background
Bash mixed-turn shape could not be reproduced.

## Upstream fixes in `claude-agent-acp` v0.66.0

The investigation was conducted against `claude-agent-acp` v0.23.0. Re-examining against
the currently-deployed v0.66.0 (via `scripts/repro-acp-hang.js`) shows the following
identified issues have been fixed upstream:

| Issue | Fix | PR |
|-------|-----|-----|
| Cancel racing with first result — result consumed as background task result, skipping `session.cancelled` guard | Moved `session.cancelled` check **before** the `!promptReplayed` check | PR #458 |
| Turn never settled at `result` — required `session_state_changed: idle` which could lag or never arrive | Turn settles at terminal `result`; `idle` handling absorbs owed trailers gracefully | Issue #773 |
| `local_bash` (run_in_background) background tasks not deferred — caused iterator contamination for next turn | Indefinite poll loop keeps turn open while `local_bash` tasks resolve | PR #353 Fix 2 |
| Cancel not aborting `TaskOutput {block: true}` polling a wedged background task | Cancel race backstop: `cancelController` races against `query.next()`, force-settles cancelled turns even when SDK query is wedged | PR #742 |
| `session_state_changed` missing when Claude Code binary lacks `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` env var | Added `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=0` opt-out via env var | PR #498 |

**One remaining gap (theoretical):** The prompt loop's `while(true)` in `acp-agent.js:1557`
continues waiting for `idle` after the turn settles at `result`. If `idle` never arrives
(rare edge case), the loop waits forever. The `cancel()` race backstop (PR #742) can
force-settle in this case, but only if something calls `cancel()`. There is no
wall-clock timeout in the bridge itself. A jarvis_bridge-side silence-based timeout
in `emit()` would serve as the backstop if needed.

## Reproduction script

`scripts/repro-acp-hang.js` — a standalone script that spawns `claude-agent-acp@0.66.0`,
creates a session, and exercises prompts including Task subagent scenarios. Both normal
prompts and Task subagent prompts resolved cleanly with `stopReason: end_turn` during
testing — no hang was reproducible.

## Files modified

- `docs/acp-notes.md` — new section: "A turn can hang forever if the agent never resolves
  `session/prompt` — no ACP status/poll exists, only cancel."
- `docs/oss-exploration/claude-agent-acp-exploration.md` — added `Turn.deferredSettle` mechanism
  and "no status/poll RPC" note to "Worth knowing about."
- `scripts/repro-acp-hang.js` — reproduction/verification script added.
- No source code changed this session.

## Follow-up / next steps

- Session `c0e3d09e-26c6-44f4-833d-03940ceaf5b0` — cancelled ✅
- Silence-based timeout in `emit()` — not pursued (touches don't-touch zone, no reproducible hang)
- File upstream issue — not pursued (investigate more first)

(End of file — total 74 lines + this update block)
