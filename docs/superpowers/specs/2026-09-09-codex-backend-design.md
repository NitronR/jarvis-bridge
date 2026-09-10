# Codex backend support via `@agentclientprotocol/codex-acp`

- **Date:** 2026-09-09
- **Status:** Design (pre-implementation)

## Summary

Add OpenAI Codex as a first-class jarvis_bridge backend by running the
`@agentclientprotocol/codex-acp` ACP adapter as the backend subprocess — the same
pattern already used for Claude (`@agentclientprotocol/claude-agent-acp`). Because
Codex does not natively speak ACP (it exposes its own app-server JSON-RPC), the
adapter is the bridge: it starts the Codex app server, translates ACP requests into
Codex operations, and maps Codex events back to standard ACP `session/update`
notifications.

This is a small change. The ACP layer in `src/agent/acp/` is already backend-agnostic;
Codex's `initialize` response advertises most of the surface jarvis reads for free. The
only genuine design decision is steering, which Codex implements via a native
server-side inject RPC rather than the client-side queueing jarvis uses for
Claude/opencode today.

## Background / research

- **Codex has no native ACP.** Confirmed by opencode issue #30052 (open, community
  asking for built-in ACP) and the AWS sample-acp-bridge (lists Codex as `❌` / PTY
  mode). Claude has the same gap, which jarvis already solves with an ACP adapter.
- **`@agentclientprotocol/codex-acp` is the first-party adapter.** Same org as the
  claude adapter. It bundles a compatible `@openai/codex` dependency (so no separate
  CLI needed), spawns the Codex app server, and reads `~/.codex` for config + login —
  mirroring how the claude adapter reads `~/.claude`. Codeg (the ACP hub in
  `~/Desktop/opensource`) installs exactly this package for its Codex entry.
- **Auth is free for a logged-in user.** On startup the adapter runs
  `checkAuthorization()` → `authRequired()`. If `~/.codex` is already signed in, **no
  ACP auth round-trip occurs** (`src/CodexAcpServer.ts:498-513`). An unsigned user
  gets a "auth required" rejection → `codex login` out-of-band. Interactive
  ACP `authenticate`/URL-elicitation is deferred (see Non-goals).
- **Probed version:** `@agentclientprotocol/codex-acp` 1.10.0 (source read from a
  `--depth 1` clone of `agentclientprotocol/codex-acp`). Recapture against a live
  session before relying on resume/Past Chats (see § Verification).

## Design

### 1. Backend profile (`agents.json`)

Add a profile alongside the existing `opencode` / `claude` / `antigravity` entries:

```json
{
  "name": "codex",
  "kind": "codex-acp",
  "command": "npx",
  "args": ["-y", "@agentclientprotocol/codex-acp@latest"],
  "env": {}
}
```

The `kind` value is only used by `usageQuery` (`src/agent/acp/index.ts:139`), which
stays off for codex (see Non-goals). Every other backend behavior is negotiated at
runtime by `connect()`, so no further jarvis code is required for the core surface.

### 2. Capability detection (`connect()`, `src/agent/acp/index.ts:155-182`)

Codex's `initialize` response advertises (probed `src/CodexAcpServer.ts:344-382`):

- `sessionCapabilities: { resume, list, close, delete, fork, additionalDirectories, subagents }`
- `loadSession: true`
- `promptCapabilities.image: true`
- `_meta.steering.supported: true` (native server-side steering)
- **no** `_meta.claudeCode.promptQueueing`

The standard fields (`canFork`, `sessionDelete`, `images`, plus `list`/`resume`/
`loadSession` from `sessionCapabilities`) already light up via existing reads in
`connect()` — no change needed there.

**One tweak — steering detection.** Jarvis currently sets `steer = promptQueueing`
(`src/agent/acp/index.ts:178`), which reads only `_meta.claudeCode.promptQueueing`.
Codex advertises steering differently, under `_meta.steering.supported`. Add a new
capability flag, `nativeSteering`, plus widen `steer`:

```typescript
const steeringMeta = caps._meta?.steering?.supported === true;
const promptQueueing = caps._meta?.claudeCode?.promptQueueing === true;
this.capabilities.steer = promptQueueing || steeringMeta;
this.capabilities.nativeSteering = steeringMeta;
this.capabilities.promptQueueing = promptQueueing;
```

`nativeSteering` (new `AgentCapabilities` field, mirrored in the frontend
`frontend/src/api/types.ts`) tells the frontend which transport the Steer button uses:
native `_session/steering` RPC for codex vs. client-side FIFO queueing for
Claude/opencode. Keep the existing `promptQueueing` read intact for Claude/opencode;
`promptQueueing` stays false for codex (codex's queueing is exposed via steering, not
the claude extension key).

### 3. Steer — codex uses native server-side injection

Jarvis's current steer is **client-side queueing** (`promptQueueing`): the Steer button
enqueues a message in the frontend FIFO (`useChat.ts:237-244`), which drains only
*after* the current turn ends — it never interrupts the running turn.

Codex's steering is a **native server-side inject**:

- Method: `_session/steering` (`SESSION_STEERING_METHOD`, `src/AcpExtensions.ts:43`)
- Request: `{ sessionId, prompt: ContentBlock[] }`
- Response: `{ outcome: "injected" | "startedNewTurn" | "failed" }`
- Behavior: injects the prompt into the live turn when one is running, otherwise starts
  a new turn (`src/CodexAcpServer.ts:1527`); server-side per-session queue
  (`SteeringQueue`, `src/CodexAcpServer.ts:1470-1501`).

**Approach (recommended, Option A): map codex's native steering onto the same Steer
button.** When the user clicks Steer on a codex session, send `_session/steering`
through the existing `AcpConnection` instead of the client FIFO. This gives codex
**true mid-turn steering** (the stronger behavior) while Claude/opencode keep their
existing drain-after-turn queueing. The `{outcome}` drives the UI (e.g. a
`steer-ack`-style signal on `injected`/`startedNewTurn`, no-op on `failed`).

Scope of the steer change:
- Backend (`src/agent/acp/index.ts`): add a native-steer code path on
  `AcpAgentSession`, gated on `nativeSteering`, that issues `_session/steering`. This
  is a re-add of the `steer?` optional method on `AgentSession` (`types.ts:49`) and its
  `POST /chat/steer` route (both deleted in the steer redesign; see
  `docs/archives/2026-08-09-steer-feature-root-cause.md`).
- Server (`src/server.ts`): re-add `POST /chat/steer`; it routes to
  `session.steer(prompt)` when the backend advertises `nativeSteering`, else returns a
  400/unsupported (the queue-based path is handled client-side and needs no route).
- Frontend (`useChat.ts` / `Composer.tsx`): `onSteerComposer` calls the native
  `/chat/steer` route when `capabilities.nativeSteering` is true, else falls back to
  the current `enqueueMessage` (client-side queue).

### 4. Docs

- Add `docs/agent-codex.md` (binding profile), mirroring `docs/agent-claude-code.md`:
  invocation, transport, auth model, known wire-shape gotchas captured from the live
  probe (see § Verification).
- Update `AGENTS.md` → Backend configuration section to list the codex profile and the
  steering capability note.
- Optionally archive the research notes under `docs/oss-exploration/` if a dedicated
  codex-exploration file is wanted.

### 5. Tests

- **Capability detection:** a fixture/adapter-level test that a codex-style
  `initialize` response (`_meta.steering.supported`, no `claudeCode.promptQueueing`)
  yields `capabilities.steer === true` and `promptQueueing === false`.
- **Steer round-trip:** a codex-style session whose steer path sends `_session/steering`
  and maps the `{outcome}` response; assert the wire method and that an `injected`
  outcome surfaces as a steer-ack to the frontend.
- **Regression:** existing tests (claude/opencode-style `initialize`) still yield
  `steer === promptQueueing`.
- Add the codex profile to the test `agents.json` fixture if one exists.

## Non-goals (deferred)

- **`usageQuery` for codex.** Jarvis gates the usage-query button on
  `kind === "claude-acp"` because it shells out to a separate CLI that supports it
  (`claude --print "/usage"`). Codex has no equivalent probe wired yet; the on-demand
  rate-limit button stays off. Basic per-turn context/token usage via
  `usage_update` notifications still flows through `mapping.ts` for free.
- **Interactive ACP `authenticate` / URL-elicitation login flow.** The adapter supports
  it, but relying on out-of-band `codex login` (reusing `~/.codex`) is simpler and
  matches how the claude backend treats auth. Only if an unsigned-user flow is needed
  later would jarvis handle `authMethods` / `_auth/status_update`.
- **Goal / async-task / review extension surface.** The adapter advertises these
  (`_meta.goal`, `_meta.jetbrains.*`), but they are beyond the core chat surface and
  not surfaced by jarvis. The goal is to keep the first iteration to what the ACP core
  maps for free plus steering.
- **Subagent-session negotiation.** The adapter's native subagent sessions require a
  draft ACP capability handshake; jarvis doesn't negotiate it, so subagents fall back
  to ordinary ACP tool calls (the adapter's documented legacy fallback). No action
  needed, just a known boundary.

## Verification

- Probe the real wire shape against a live codex session before relying on
  resume/Past Chats, mirroring `docs/agent-claude-code.md` (the adapter may have
  `session/load` replay quirks worth pinning).
- Confirm the steering RPC round-trips against a live turn (inject mid-turn) and an
  idle session (start new turn).
- Confirm an already-signed-in `~/.codex` needs no ACP auth step, and an unsigned user
  gets a clean "auth required" → `codex login` message.