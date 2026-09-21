# Agent Binding Profile — Codex (`agent-codex.md`)

> **Status:** Confirmed against `@agentclientprotocol/codex-acp` 1.11.0 via live ACP handshake
> + probe on 2026-09-10 (throwaway gateway, `POST /chat/init`, `/chat/send`,
> `/chat/steer`, fork/delete). Auth reused the existing `~/.codex` API-key login
> (`auth.json`, `auth_mode` API-key) with no ACP auth round-trip. Where a source read
> differed from the live probe, the probe won and the discrepancy is called out below
> (see §3 — the `_meta.steering` location bug).

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
payload. The response (confirmed live against 1.11.0) advertises:

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

**⚠️ `_meta.steering` location — the one wire gotcha the live probe caught.** Codex
advertises steering at the **top-level** `_meta` of the initialize response
(`initRes._meta.steering.supported`), *not* under `agentCapabilities._meta` where claude's
`promptQueueing` lives. jarvis reads it via `initRes._meta?.steering?.supported`
(`src/agent/acp/index.ts`). A first implementation read `caps._meta` (the
`agentCapabilities._meta` path) and silently got `false` against the real adapter — the
probe caught it. If steering ever stops lighting up, check which `_meta` level the adapter
is advertising on.
| `_meta.claudeCode.promptQueueing` | **absent** | `capabilities.promptQueueing = false`. Codex's steering is not the claude cancel-and-run-next path; it's the native `_session/steering` RPC |
| `authMethods` | varies | depends on login state; see §4 |

Codex advertises several extensions jarvis_bridge does **not** negotiate: `_meta.goal`
(provider-neutral goal extension), `_meta._jetbrains/air` (JetBrains AIR extension), and
native `subagents` (draft ACP RFD). These are outside the core chat surface and are
Non-goals (see design spec). Codex's own `usage_update` notifications still flow through
`mapping.ts` for context/token usage.

---

## 4. Auth

**Confirmed live (2026-09-10)** — the probe reused an existing `~/.codex` login
(`auth.json` with `auth_mode: "api-key"` and an `OPENAI_API_KEY`) and `POST /chat/init`
created a codex session with **no ACP auth round-trip** — `initialize` just succeeded
silently.

- The adapter advertises ACP auth methods during `initialize` (`authMethods`), but for a
  user who has already run `codex login` (which writes `~/.codex`), `checkAuthorization()`
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
`{ accepted: false, reason: "steer failed" }` for `failed`. **Confirmed live:** an idle
session steered with `POST /chat/steer` returned `{ accepted: true }` and the steered
prompt appeared as a new user turn with assistant output on the next replay.

**Session rename mirror.** When the user renames a session in the gateway UI, jarvis sends
`/rename <title>` as a `session/prompt` so the backend's own session list (e.g. `codex
--continue`, the Codex app) picks up the new title. Gate: only when the agent advertises a
builtin `rename` command via `available_commands_update` (dropped silently when the agent
doesn't), and — because codex intercepts `/rename` client-side via `threadSetName` — the
busy gate in `renameSession` is relaxed for `capabilities.nativeSteering` backends, so a
mid-turn rename is allowed (queueing backends keep the gate: a mid-turn prompt would
cancel-and-run-next). Renames consume **zero model quota**. **Confirmed live (2026-09-12)**:
`/rename <title>` worked on an idle session and mid-turn (no cancel, both turns completed),
emitting `session_info_update { title }`, with the title persisted in `session/list`.

---

## 6. Usage / tokens

`usage_update` notifications flow through `mapping.ts` for free (context/token usage, the
Composer status line). The on-demand rate-limit **Usage button** (`queryUsage`) is also
enabled: it launches a short-lived `codex app-server`, performs the app-server initialize
handshake, then calls `account/rateLimits/read`. The result is normalized into the shared
usage meters based on the reported window durations (including three-hour, five-hour,
and seven-day windows), with exact reset timestamps. The query uses `CODEX_PATH` when
configured; otherwise it reuses the configured adapter command with `cli app-server`
(for example, `npx -y @agentclientprotocol/codex-acp@latest cli app-server`). The adapter
resolves its bundled Codex binary, so no standalone `codex` installation or gateway PATH
entry is required. The usage subprocess inherits the backend environment, including
`CODEX_HOME`. This passthrough was verified against codex-acp 1.11.0; custom wrappers must
forward the `cli app-server` arguments, or set `CODEX_PATH` explicitly.

---

## Non-goals (see design spec for rationale)

- Interactive ACP `authenticate`/URL-elicitation login; rely on out-of-band `codex login`.
- Goal / async-task / review extension surface (`_meta.goal`, AIR extension).
- Native subagent-session negotiation (falls back to ordinary ACP tool calls).

---

## Verification (confirmed live 2026-09-10)

Probed against `@agentclientprotocol/codex-acp` 1.11.0 on a throwaway gateway, using the
existing `~/.codex` API-key login. All confirmed:

- `POST /chat/init?backend=codex` → created a session, `model: gpt-5.6-terra`,
  `canFork/sessionDelete/images/nativeSteering: true`, `promptQueueing: false`.
- `POST /chat/send` → streamed `thought → text → usage → done` (13732 in / 57 out,
  context 20701/258400). Chat works end-to-end.
- `GET /chat/init?sessionId=...` → `resumed: true`, history replayed (user msg + assistant
  patches). Resume works.
- `POST /chat/sessions/fork` → `ok: true`, new session created. Fork works.
- `DELETE /chat/sessions/:id` → 200, and re-resume 404s (session gone). Delete works.
- `POST /chat/steer` → `{ accepted: true }`; replay then shows the steered prompt as a new
  user turn with assistant output. Native mid-turn steering works.
- Session rename mirror → `/rename` sent as `session/prompt`; works idle and mid-turn
  (busy gate relaxed for `nativeSteering`), `session_info_update { title }` emitted, title
  persisted in `session/list`; zero model quota (confirmed 2026-09-12).
- **Gotcha found:** steering `_meta` is top-level, not under `agentCapabilities` — see §3.

Not probed: the unsigned-user "auth required" path (the local login is valid). Expected to
surface as a gateway error → out-of-band `codex login` (see §4).
