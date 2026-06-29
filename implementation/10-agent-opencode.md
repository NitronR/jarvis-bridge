# Agent Binding Profile — OpenCode (`10-agent-opencode.md`)

> **Status:** Draft for review. Confirmed against `opencode 1.17.11` via live ACP handshake + probe on 2026-06-28.
> **Companion edits:** `02-acp-backend.md` — see `02-acp-backend-edits.md` for the diff plan.

This doc is the **single place** that pins the abstract knobs in `02-acp-backend.md` to concrete opencode values. It is intentionally **separate** from the generic spec so the generic spec stays agent-agnostic.

---

## 1. Invocation

| Knob | Value |
|---|---|
| `command` | `opencode` |
| `args` | `["acp"]` |
| Resolve path | `which opencode` on `$PATH`; otherwise fall back to `~/.opencode/bin/opencode` |
| Working dir | spawn `--cwd <workspace>` is **not** a flag; pass `cwd` via `session/new` instead. opencode reads it from the per-session request. |
| Stderr | log at debug; drop non-JSON lines (ACP is ndjson on stdout; stderr is opencode's own log stream). |
| Useful opencode flags (out-of-band, not for ACP) | `--print-logs`, `--log-level`, `--port`, `--cors`, `--mdns` — only relevant if also running opencode's own server. |

Versions probed: `opencode 1.17.11` (model `MiniMax-M3`). Recapture if you upgrade — ACP method strings drift.

---

## 2. Transport

- **Framing:** newline-delimited JSON-RPC 2.0 over stdio. **Not** LSP `Content-Length`.
- **One JSON object per line.** Spec warns: ignore non-JSON lines on stdout; never crash the pump on a malformed line.
- The line-framer in `src/agent/acp/jsonrpc.ts` is correct as written.

---

## 3. Handshake (`initialize`)

**Request shape** that opencode accepts:
```json
{
  "protocolVersion": 1,
  "clientCapabilities": {
    "fs": { "readTextFile": true, "writeTextFile": true },
    "terminal": true
  },
  "clientInfo": { "name": "<your-app>", "version": "<x.y.z>" }
}
```

> **Note on `fs` capability:** advertising it is **safe but inert**. opencode does **not** call back via `fs/read_text_file` or `fs/write_text_file` — it uses its own internal `edit` tool regardless. See §7 for the dead-code implication.

**Response** (verbatim, from live probe):
```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": true,
    "mcpCapabilities": { "http": true, "sse": true },
    "promptCapabilities": { "embeddedContext": true, "image": true },
    "sessionCapabilities": { "close": {}, "fork": {}, "list": {}, "resume": {} }
  },
  "authMethods": [
    { "id": "opencode-login", "name": "Login with opencode", "description": "..." }
  ],
  "agentInfo": { "name": "OpenCode", "version": "1.17.11" }
}
```

**Capability surface — what's actually available:**

| Capability | opencode value | Implication |
|---|---|---|
| `loadSession` | `true` | `/chat/resume` works |
| `mcpCapabilities.http` | `true` | MCP-over-HTTP servers supported |
| `mcpCapabilities.sse` | `true` | MCP-over-SSE servers supported |
| `mcpCapabilities.stdio` | not advertised | don't assume stdio MCP works |
| `promptCapabilities.embeddedContext` | `true` | can send file refs in prompts |
| `promptCapabilities.image` | `true` | can attach images to prompts |
| `sessionCapabilities.{close,fork,list,resume}` | all `{}` | full session lifecycle |
| **`extensions`** | **absent** | **`supportsSteer = false`** — hide the steer control in the UI |
| `authMethods` | non-empty | surfaced, but only invoke `authenticate` on auth error |

---

## 4. Auth

opencode needs a configured provider before any turn.

- **Default:** user runs `opencode auth login` once. Credentials persist at `~/.local/share/opencode/auth.json`.
- **Programmatic:** set `OPENCODE_API_KEY` (plus provider-specific keys) in the spawned subprocess's `env`.
- **Runtime detection:** if a turn fails with an auth error, surface `authMethods` and offer the user a path (either re-run `opencode auth login` interactively or set the env var).
- **Non-blocking:** `authMethods` is advertised but the session works immediately if creds are present. Do **not** pre-emptively call `authenticate`.

---

## 5. Session lifecycle

### `session/new`

**Request:**
```json
{ "cwd": "<absolute path>", "mcpServers": [] }
```

**Response:**
```json
{
  "sessionId": "ses_…",
  "configOptions": [
    { "id": "model", "currentValue": "<modelId>", "options": [ { "value": "...", "name": "..." } ] },
    { "id": "mode",  "currentValue": "build",        "options": [ { "value": "build" }, { "value": "plan" } ] }
  ]
}
```

> **Spec fix:** `02-acp-backend.md` §3 currently describes a flat `availableModels` / `currentModelId`. opencode returns **`configOptions[]`**. Parse it as:
> - models = `configOptions.find(o => o.id === "model").options` (each has `.value` and `.name`)
> - currentModel = `configOptions.find(o => o.id === "model").currentValue`
> - the **`mode` option (`build` / `plan`)** also lives here and is currently undocumented in `02`. It maps to your plan-mode idea.

### `session/set_model`

**Request:**
```json
{ "sessionId": "...", "modelId": "..." }
```

**Response:** `{}` (success). This is what backs `setSessionModel` and any `/chat/model` UI control.

### `session/cancel`

Cancels the in-flight turn. Standard.

---

## 6. Streaming turn (`session/prompt` → `session/update`)

**Prompt request:**
```json
{
  "sessionId": "...",
  "prompt": [ { "type": "text", "text": "..." } ]
}
```

**Streaming notifications** (`params.update.sessionUpdate` discriminator):

| `sessionUpdate` | Carries | Maps to |
|---|---|---|
| `agent_thought_chunk` | reasoning deltas (`content.text`, `messageId`) | thought channel in `ChatPatch` |
| `agent_message_chunk` | visible answer deltas | assistant text in `ChatPatch` |
| `tool_call` | new call: `toolCallId`, `title`, `kind` (`read`/`edit`/`bash`/…), `status:"pending"`, empty `rawInput`, empty `locations` | append a pending tool-use card |
| `tool_call_update` | `status` → `in_progress` → `completed`, fills `locations[]`, `content[]`, `rawInput`, `rawOutput` | update the tool-use card |
| `usage_update` | live context window: `{used, size, cost:{amount,currency}}` | `UsageTotals` (see §8) |
| `available_commands_update` | slash commands list (one shot, right after session start) | populate the `/` menu |

**Final `session/prompt` result:**
```json
{
  "stopReason": "end_turn",
  "usage": {
    "inputTokens": <int>,
    "outputTokens": <int>,
    "totalTokens": <int>,
    "thoughtTokens": <int>,
    "cachedReadTokens": <int>
  }
}
```

Pin these exact strings in `src/agent/acp/mapping.ts`. ACP is young — drift between versions is the norm.

---

## 7. Agent → client callbacks

opencode can call **back** into the client mid-turn and block on the response. Your client **must** implement handlers for these even though not all of them fire on opencode today:

| Callback | Fires on opencode? | Required handler? |
|---|---|---|
| `session/request_permission` | **Yes** (verified — fired in probe) | **Required.** Options: `{allow_once, allow_always, reject_once}`. Wire to your approval modal. Fail-safe default: `reject_once` when auto-approve is off or no live stream exists. |
| `fs/read_text_file` | **No** — opencode uses its own `read` tool regardless of advertised `fs` capability | **Not required.** Safe to omit. |
| `fs/write_text_file` | **No** — opencode uses its own `edit` tool regardless | **Not required.** Safe to omit. |

> **Conclusion:** advertise `fs` in `clientCapabilities` if you want — it's a no-op — but **do not** implement `fs/*` handlers. Doing so is dead code on opencode. The current `02-acp-backend.md` §7 should either remove `fs/*` from the required list or annotate it as agent-defined.

---

## 8. Usage

`usage_update` notifications carry `{used, size, cost:{amount, currency}}` for the **live context window**. The final `session/prompt` result carries per-turn `{inputTokens, outputTokens, totalTokens, thoughtTokens, cachedReadTokens}`.

**Additions vs the spec's `UsageTotals`:**

| Field | opencode carries | Spec currently has | Action |
|---|---|---|---|
| `cost.{amount, currency}` | yes | no | **Add** `cost?: { amount: number; currency: string }` if you want to surface cost in the JARVIS HUD. Otherwise drop. |
| `thoughtTokens` | yes | no | **Add** `thoughtTokens?: number` if you want a separate reasoning-cost line. Otherwise fold into `outputTokens`. |
| `cacheWrite` / `cache_creation_input_tokens` | **no** | spec assumes yes | **Drop** — opencode has no cache-write metric. |
| `cachedReadTokens` | yes | yes | Keep as-is. |

---

## 9. `available_commands_update`

Sent exactly once, right after session start, before any `session/prompt`. Shape:

```json
{ "availableCommands": [ { "name": "<cmd>", "description": "<text>" }, ... ] }
```

opencode 1.17.11 emits 32 commands (verified). Populate the `/` menu from this list — do not hardcode.

---

## 10. Probe transcript (reference)

Captured at `/tmp/opencode-probe/probe.jsonl` on 2026-06-28 against `opencode 1.17.11`. One short `session/prompt` turn that asked the model to write a sentinel file. Notable: zero `fs/*` callbacks despite advertising `fs` capability; one `session/request_permission` callback that auto-approved.

Re-run this probe after any opencode upgrade before treating this doc as current.

---

## 11. Known gaps / open questions

- **`fs/*` handlers in spec:** should `02-acp-backend.md` §7 remove `fs/read_text_file` / `fs/write_text_file` from the "must implement" list, or keep them as agent-defined opt-ins? Recommend: keep, but mark explicitly as opt-in per agent.
- **`cost` / `thoughtTokens` in `UsageTotals`:** add to `UsageTotals` or drop on the floor? Recommend: add, both — they're cheap to carry and the JARVIS HUD will want them.

---

## 12. Drift notes (date → what changed, why)

- **2026-06-29 — Empty-reply bug fix.** The spec at line 143 has always described the envelope correctly: `params.{ sessionId, update: { sessionUpdate, ... } }`. But `src/agent/acp/index.ts:handleSessionUpdate` was reading `params.update.sessionUpdate` as if `params` itself were the body — i.e. it treated `params.sessionUpdate` (always undefined on real opencode) and ignored the actual update envelope. Result: every `agent_message_chunk` was dropped on the floor; the client only ever saw `usage_update` + `done` and rendered an empty bubble. The fake-streaming-agent fixture happened to emit the flat shape too, so unit tests passed in isolation. Fix unwraps `params.update` first; `test/fixtures/fake-streaming-agent.cjs` now emits the nested shape to match opencode, and `src/agent/acp/index.test.ts` has a regression test that asserts two text deltas reconstruct the full reply. Symptom was reproducible against the real opencode process by pointing `.env` at `AGENT_CMD=opencode` and asking any question.
- **Steer:** `extensions` is absent from opencode's capability set → `supportsSteer = false`. Frontend should hide the steer control when this is false.
