# Detecting and streaming a backend-active session that jarvis didn't start (passive turn promotion)

Status: draft
Date: 2026-09-21

## Problem

When a session becomes active *inside the agent backend* but jarvis_bridge has no
gateway-owned turn for it, a page refresh (or any fresh `GET /chat/init`) loads and
replays the completed history but never streams the live response.

The July-15 reconnect design handles the "jarvis started the turn" case: `sendMessage()`
populates `SessionContext.activeTurn`, which buffers every patch independent of any viewer,
so init sees `activeTurn: true`, skips `loadSession()`, and `/chat/stream` reattaches with
buffered-replay-then-live. That machinery is solid.

The gap is any session busy in the agent subprocess **without** a gateway `activeTurn`, in
three concrete cases:

- **(a) External turn** — a task started outside jarvis (Claude/Codex/opencode CLI, another
  client/instance) against the same session.
- **(b) Gateway restart mid-turn** — the in-memory `activeTurn` buffer is gone; the agent
  keeps working.
- **(c) Post-done continuation** — jarvis already emitted `done` (spinner off), but the
  agent keeps going: background subagents, deferred work, an autonomous follow-up turn.

In all three cases init today returns `activeTurn: false` and calls `loadSession()`. The
agent's live `session/update` notifications still arrive on the gateway's always-on ACP
connection, but with `ctx.onPatch` null and `ctx.captureReplay` false they are **silently
dropped** — the transcript shows the frozen replay and never the live tail.

## Constraints and decisions (from brainstorming)

- **No polling, no standing push channel.** The page refresh / `GET /chat/init` is the only
  trigger for discovering a backend-active session. Accepted trade-off: a session that is
  busy but silent during the detection window may only surface at the next refresh.
- **Scope is all three cases (a)/(b)/(c)** — one mechanism, not three.
- **`done` is never synthesized early.** ACP has no status RPC, and no surveyed project
  (Zed, codeg, claude-agent-acp, opencode) emits a backend-push completion. Their shared
  model: *while notifications arrive the turn is alive; quiet is "still working", not
  "done"; completion is only ever confirmed by the local prompt resolving or the next
  history replay.*
- **Reuse the existing `activeTurn` / `/chat/stream` / frontend reattach machinery
  unchanged.** We promote the untracked incoming update stream into a *passive* turn that
  behaves like a gateway turn for all downstream purposes.
- **Passive turns are never auto-cancelled by the idle reaper** (the codeg
  "no-background-work" exemption) — an agent doing legitimate quiet background work must
  not be killed because nobody is watching.

## Design

### 1. Liveness signal and where promotion happens

The only true busy signal ACP offers is a `session/update` notification that is *not* part
of a history replay. `SessionContext.captureReplay` is true only while `loadSession()` is
draining the replayed history and settles (via `waitForReplayIdle`) shortly after. So:

> **Promotion rule (in `AcpAgentSession.handleSessionUpdate`):** when a message-part update
> (`agent_message_chunk`, `user_message_chunk`, `tool_call*`, `agent_thought_chunk`,
> `session/request_permission`, etc.) arrives for a ctx that (i) is not mid-replay-capture
> (`captureReplay` false) and (ii) has no `activeTurn`, promote it:
> create an `activeTurn` with `origin: "passive"` on that ctx and route the patch into it.

This handles all three cases with one rule and no extra wire protocol. It also means a
busy-but-untracked session starts buffering the moment the agent emits, even if nobody is
watching — that buffered state is what a later refresh reconnects to.

### 2. The detection window inside `GET /chat/init`

For the ordinary refresh path (sessionId present, no in-memory `activeTurn`:

1. `loadSession()` replays history as today; `waitForReplayIdle` drains the replay burst.
2. **Probe window** — after the drain, wait up to `PASSIVE_TURN_PROBE_MS` (constant, ~1s)
   for the promotion rule to fire. Resolve early as soon as a passive `activeTurn` appears.
3. Return `activeTurn: true` if a passive turn was promoted, else `activeTurn: false` and
   continue with normal (idle) behavior.

Costs:
- **Idle session:** init takes ~ +1s (probe times out silently). Bounded, invisible beyond
  a slight refresh delay, and only on the first refresh after becoming untracked — once a
  passive turn is promoted it stays in memory, so subsequent refreshes hit the existing
  fast path (`activeTurn: true`, no load).
- **Busy session:** init returns as soon as the first live patch lands (early exit), then
  the unmodified frontend reattach effect opens `/chat/stream` and replays the buffer.

The probe is race-based (`Promise.race` of a promotion signal vs. the timeout), never a
blocking sleep. It does not run on the fresh-session path.

### 3. Turn-end semantics for a passive turn

- The passive turn lives while patches flow. Each patch resets a quiet timer set to
  `getIdleTurnGraceMs()` (the existing 5-min idle-turn-grace knob, env
  `JARVIS_BRIDGE_IDLE_TURN_GRACE_MS`).
- When the timer fires with no new patch, synthesize `done` (deliver to any attached
  viewer, mark the turn done) and retire it (`ctx.activeTurn = null`). A later notification
  simply promotes a fresh passive turn.
- The idle-viewer reaper must **exempt** `origin: "passive"` turns: no auto-cancel, ever.
- The next `loadSession()` naturally replays the completed turn in history, which is the
  durable record; the passive turn is only an in-memory streaming bridge.
- `done`/usage/error handling flows through the same `ActiveTurn` terminal fields the
  gateway turn uses, so `/chat/stream`'s existing "end on done/error" path is unchanged.

### 4. Data-flow summary

```
agent emits session/update ─► handleSessionUpdate
                                  ├─ captureReplay true  ─► replayHistory (existing load/replay)
                                  ├─ activeTurn present   ─► route into activeTurn (existing send / stream)
                                  └─ else                 ─► promote passive activeTurn (NEW)
                                                              └─ buffer patches; /chat/stream can attach;
                                                                 viewerCallback delivers to attached browser;
                                                                 quiet timer → done → retire (origin: passive)
```

### 5. Error handling

- `/chat/stream` 404 when no active turn remains (existing) — if the passive turn retired
  between init and stream open, the frontend's existing 404 → `init` fallback re-loads
  (history now contains the turn) exactly as it does for gateway turns today.
- Replay/stream double-up: the frontend's existing "clear the last assistant entry seeded
  from history before `/chat/stream` replays the buffer" heuristic (`useChat.ts:126-145`)
  is reused as-is; a partially-streamed message that the backend persisted mid-flight is a
  per-backend wire-shape verification item (see Testing), not a new frontend concern.
- No changes to approval routing: while a passive turn is attached to a browser,
  `request_permission` rides the same viewer path as a gateway turn; unattached, it keeps
  its current behavior.

## References

- Existing machinery this builds on: `src/agent/acp/index.ts` (`activeTurn`,
  `handleSessionUpdate`, `loadSession`/`waitForReplayIdle`, idle reaper), `src/server.ts`
  (`GET /chat/init`, `GET /chat/stream`), `frontend/src/state/useChat.ts` (reattach effect).
- Prior approved design: `docs/superpowers/specs/2026-07-15-agent-stream-reconnect-design.md`.
- OSS comparison (documents the "quiet ≠ done, no backend-push done" consensus): Zed
  `crates/acp_thread/src/acp_thread.rs` (ThreadStatus = client-owned running_turn only),
  codeg `src-tauri/src/acp/ws_attach.rs` (subscribe-with-snapshot; idle sweep exempting
  background work), claude-agent-acp `src/acp-agent.ts` (deferredSettle; result vs idle are
  distinct signals), opencode `packages/opencode/src/acp/event.ts` (global subscription,
  replay-then-live, no done).

## Testing

- **Unit (`src/agent/acp/index.test.ts`):**
  - `handleSessionUpdate` with `captureReplay` false and no `activeTurn` promotes a passive
    turn and buffers the patch.
  - Replay-captured updates do **not** promote (replay keeps going to `replayHistory`).
  - Passive turn emits `done` and retires after a quiet window; a later patch promotes fresh.
  - Idle reaper does not cancel a passive turn.
  - Passive turn + attached viewer routes `request_permission` to that viewer.
- **Server (`src/server.test.ts`):**
  - `GET /chat/init` on a backend that emits a live notification during the probe window
    returns `activeTurn: true`; `/chat/stream` replays the buffered patches then live.
  - `GET /chat/init` on a quiet backend returns `activeTurn: false` (bounded probe).
  - Second refresh after promotion takes the fast path (no re-load, immediate
    `activeTurn: true`).
- **Per-backend wire-shape verification (live probe, matches the pattern in
  `docs/agent-claude-code.md` / `docs/agent-codex.md`):** confirm for opencode, Claude, and
  Codex that a busy session keeps emitting post-replay notifications inside the probe
  window, and whether loadSession replays a partially-streamed in-flight message (drives
  the double-up heuristic above).