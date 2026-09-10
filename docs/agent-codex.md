# Agent Binding Profile — Codex (`agent-codex.md`)

> **Status:** Design-based; source-level probe of `@agentclientprotocol/codex-acp` 1.10.0
> (a `--depth 1` clone of `agentclientprotocol/codex-acp`). Live wire-shape values from a
> running session are pending — see § Verification in
> `docs/superpowers/specs/2026-09-09-codex-backend-design.md` / Task 8. Where the live
> probe differs from this source read, the probe wins; capture those deltas here.

This is the Codex-specific counterpart to `docs/agent-claude-code.md` — same structure,
built around `@agentclientprotocol/codex-acp`. Codex does **not** natively speak ACP
(it exposes its own app-server JSON-RPC), so jarvis_bridge drives it through the first-party
ACP adapter, exactly as it drives Claude through `claude-agent-acp`.

---

## 1. Invocation

| Knob | Value |
|---|---|
| `command` / `args` | `npx -y @agentclientprotocol/codex-acp@latest` (see `agents.json.example`) |
| Working dir | passed via `session/new`'s `cwd`, same as opencode/Claude — not a spawn-time flag |
| Auth | CLI-delegated: the adapter reads `~/.codex` (the same config/login the `codex` CLI uses). No API-key env var is required for an already-logged-in user |
| Native binary resolution | the adapter bundles a compatible `@openai/codex` dependency and runs its app server internally; set `CODEX_PATH` to point at a specific `codex` binary instead |

The `codex-acp` npm package carries its own `@openai/codex` runtime, so it runs on a
machine that has never seen the standalone `codex` CLI. `agents.json`'s codex profile needs
no `env` overrides for the common case.

---

## 2. Transport

Same as opencode/Claude: newline-delimited JSON-RPC 2.0 over stdio, one JSON object per
line, tolerate non-JSON lines. `src/agent/acp/jsonrpc.ts` needed no changes. The adapter
spawns the Codex app server as a subprocess and translates between ACP and the app-server
protocol.

---

## 3. Handshake (`initialize`)

The request is unchanged from the shared `AcpAgentBackend.connect()` — no Codex-specific
payload. The response (from `src/CodexAcpServer.ts:344-392`, source probe) advertises:

```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": { "embeddedContext": true, "image": true },
    "sessionCapabilities": {
      "resume": {}, "list": {}, "close": {}, "delete": {}, "fork": {},
      "additionalDirectories": {}, "subagents": {}
    },
    "mcpCapabilities": { "acp": false, "http": true, "sse": false },
    "_meta": {
      "steering": { "supported": true },
      "goal": { "version": "<goal-ext-version>", "controlMethod": "<goal-control-method>", "actions": [] },
      "_jetbrains/air": {}
    }
  },
  "authMethods": [ ...depends on client capabilities / login state... ]
}
```

**Capability surface:**

| Capability | Codex value | Implication |
|---|---|---|
| `loadSession` | `true` | resume works, same as opencode/Claude |
| `sessionCapabilities.{delete,fork,list,resume}` | present | `sessionDelete` / `canFork` / Past Chats / resume all auto-enable via the shared `connect()` reads — no jarvis code needed |
| `promptCapabilities.image` | `true` | image attachments work |
| `_meta.steering.supported` | `true` | **native server-side steering.** Read as `capabilities.nativeSteering = true` and `capabilities.steer = true`. This is the difference from Claude/opencode: see § Steering |
| `_meta.claudeCode.promptQueueing` | **absent** | `capabilities.promptQueueing = false`. Codex's steering is not the claude cancel-and-run-next path; it's the native `_session/steering` RPC |
| `authMethods` | varies | depends on login state; see §4 |

Codex advertises several extensions jarvis_bridge does **not** negotiate: `_meta.goal`
(provider-neutral goal extension), `_meta._jetbrains/air` (JetBrains AIR extension), and
native `subagents` (draft ACP RFD). These are outside the core chat surface and are
Non-goals (see design spec). Codex's own `usage_update` notifications still flow through
`mapping.ts` for context/token usage.

---

## 4. Auth

Source-level understanding (live probe pending):

- The adapter advertises ACP auth methods during `initialize` (`authMethods`), but for a
  user who has already run `codex login` (which writes `~/.codex`), `checkAuthorization()`
  → `authRequired()` finds an existing login and **no ACP auth round-trip occurs**
  (`src/CodexAcpServer.ts:498-513`). This mirrors how the claude adapter silently reuses
  `~/.claude`.
- An unsigned user gets a `RequestError.authRequired()` rejection on the first session
  request, which surfaces as a gateway error → the fix is out-of-band `codex login`.
- Env knobs: `CODEX_API_KEY` / `OPENAI_API_KEY` (API-key auth), `NO_BROWSER=1` (hide
  browser-based ChatGPT login), `DEFAULT_AUTH_REQUEST` (pre-seed an auth request). jarvis
  does **not** implement the interactive ACP `authenticate`/URL-elicitation flow; it relies
  on out-of-band `codex login`. See Non-goals.

---

## 5. Session lifecycle

Same ACP methods as opencode/Claude: `session/new` (with `cwd` + `mcpServers`),
`session/load`, `session/list`, `session/fork`, `session/delete`, `session/prompt`,
`session/cancel`. All are handled by the shared `AcpAgentBackend` with no Codex-specific
code. `session/load` reconstructs the (subagent) child tree from Codex history where
relevant; for ordinary top-level sessions this is standard replay.

**Steering — the one Codex-specific behavior.** Codex exposes a native `_session/steering`
RPC (`SESSION_STEERING_METHOD`, `src/AcpExtensions.ts:43`):

- Request: `{ sessionId, prompt: ContentBlock[] }`
- Response: `{ outcome: "injected" | "startedNewTurn" | "failed" }`
- Behavior: injects the prompt into the **live turn** when one is running, otherwise starts
  a new turn (`src/CodexAcpServer.ts:1527`). Server-side per-session `SteeringQueue`
  serialises concurrent steers.

jarvis maps this onto the Steer button when `capabilities.nativeSteering` is true: the
frontend calls `POST /chat/steer`, which invokes `AcpAgentSession.steer()` → sends
`_session/steering`. This is **true mid-turn steering** (stronger than Claude/opencode's
cancel-and-run-next queueing, which drains only after the current turn ends). The
`{outcome}` maps to `{ accepted: true }` for `injected`/`startedNewTurn` and
`{ accepted: false, reason: "steer failed" }` for `failed`.

---

## 6. Usage / tokens

`usage_update` notifications flow through `mapping.ts` for free (context/token usage, the
Composer status line). The on-demand rate-limit **Usage button** (`queryUsage`) stays off:
it's gated on `kind === "claude-acp"` because it shells out to a separate CLI
(`claude --print "/usage"`); no Codex equivalent is wired. See Non-goals.

---

## Non-goals (see design spec for rationale)

- `queryUsage` (usage button) for codex.
- Interactive ACP `authenticate`/URL-elicitation login; rely on out-of-band `codex login`.
- Goal / async-task / review extension surface (`_meta.goal`, AIR extension).
- Native subagent-session negotiation (falls back to ordinary ACP tool calls).

---

## Verification (pending live probe)

Before relying on resume/Past Chats and steering in production, run Task 8 of the
implementation plan: create a codex session via `POST /chat/init`, send + replay, confirm
Past Chats/fork/delete, confirm `POST /chat/steer` injects mid-turn and starts a new turn
when idle, and confirm an unsigned user gets a clean "auth required" error. Capture the
adapter version and any wire-shape deltas here once probed.