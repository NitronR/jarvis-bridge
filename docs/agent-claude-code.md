# Agent Binding Profile — Claude (`agent-claude-code.md`)

> **Status:** Confirmed against `@agentclientprotocol/claude-agent-acp 0.58.1` (bundled `claude` CLI
> `2.1.207`) via live ACP handshake + probe on 2026-07-13.
> **Companion doc:** `docs/superpowers/specs/2026-07-12-claude-acp-backend-design.md` (Phase 1 design),
> `docs/claude-acp-future-phases.md` (deferred work).

This is the Claude-specific counterpart to `docs/archives/implementation/10-agent-opencode.md` — same
structure, pinned to real values captured from a live probe, not the earlier static source analysis
alone. Where the static analysis and the live probe disagreed, the probe wins and the discrepancy is
called out explicitly below.

---

## 1. Invocation

| Knob | Value |
|---|---|
| `command` / `args` | `npx -y @agentclientprotocol/claude-agent-acp@latest` (see `agents.json.example`) |
| Working dir | passed via `session/new`'s `cwd`, same as opencode — **not** a spawn-time flag |
| Auth | CLI-delegated: the adapter shells out to a real, pre-authenticated `claude` CLI. No API-key-env-var-first path (see §4) |
| Native binary resolution | the adapter bundles `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` as an npm optionalDependency and spawns *that* binary internally, **not** the user's own `claude` on `$PATH`, unless `CLAUDE_CODE_EXECUTABLE` is set |

Versions probed: adapter `@agentclientprotocol/claude-agent-acp@0.58.1`, underlying `claude` CLI
`2.1.207`. Recapture after upgrading either.

### ⚠️ Known environment gap: arm64/Rosetta hosts

On an Apple Silicon Mac where Node itself is an **x86_64 build running under Rosetta 2**
(`process.arch === "x64"` despite `uname -m` reporting `arm64` — check both if debugging this), `npm`
resolves the **`darwin-x64`** variant of the SDK's bundled native binary. That binary is Bun-compiled
and requires AVX; under Rosetta 2 on at least some Apple Silicon chips (confirmed: M5) it does not
crash — it **spins at ~99% CPU indefinitely** on `session/new`, never responding and never logging
anything to stderr. `claude --version` and `claude -p "..."` run directly (outside the adapter) are
completely unaffected and fast (confirmed: ~2.4s round-trip) — this is specific to the adapter's bundled
binary, not the user's own Claude Code install.

**Symptom:** `initialize` returns instantly with a normal capability payload; `session/new` (or any
first-session request) hangs forever with 99%+ CPU on a `claude` subprocess with no stderr output.

**Fix:** run jarvis-bridge's Node process under a native `arm64` Node build (so `npm`/`npx` resolves
`@anthropic-ai/claude-agent-sdk-darwin-arm64` instead), **or** set `CLAUDE_CODE_EXECUTABLE` to the
user's own working `claude` binary (`which claude`) — the adapter falls back to shelling out to it
instead of using its own bundled binary. The probe in this doc was captured using the latter (simplest,
no local Node reinstall needed). If `session/new` hangs at ~99% CPU with empty stderr, check
`process.arch` on the running Node **before** assuming the user's Claude Code auth is broken.

---

## 2. Transport

Same as opencode: newline-delimited JSON-RPC 2.0 over stdio, one JSON object per line, tolerate
non-JSON lines. `src/agent/acp/jsonrpc.ts` needed no changes.

---

## 3. Handshake (`initialize`)

**Request** (current `src/agent/acp/index.ts:122-125`, unchanged by this probe):
```json
{
  "protocolVersion": 1,
  "clientCapabilities": { "elicitation": { "form": {} } },
  "clientInfo": { "name": "jarvis-bridge", "version": "0.1.0" }
}
```

**Response** (verbatim, from `/tmp/claude-acp-probe/probe.jsonl`, `full` scenario, first `recv-response`):
```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "_meta": { "claudeCode": { "promptQueueing": true } },
    "promptCapabilities": { "image": true, "embeddedContext": true },
    "mcpCapabilities": { "http": true, "sse": true },
    "auth": { "logout": {} },
    "loadSession": true,
    "sessionCapabilities": {
      "additionalDirectories": {}, "close": {}, "delete": {},
      "fork": {}, "list": {}, "resume": {}
    }
  },
  "agentInfo": {
    "name": "@agentclientprotocol/claude-agent-acp",
    "title": "Claude Agent",
    "version": "0.58.1"
  },
  "authMethods": []
}
```

**Capability surface:**

| Capability | Claude value | Implication |
|---|---|---|
| `loadSession` | `true` | resume works, same as opencode |
| `mcpCapabilities.{http,sse}` | `true` | matches opencode |
| `promptCapabilities.{image,embeddedContext}` | `true` | matches opencode |
| `_meta.claudeCode.promptQueueing` | `true` | non-standard extension key, already read by Task 8's capability derivation — confirmed present on the real adapter |
| `sessionCapabilities.delete` | `{}` present | `sessionDelete = true` — confirmed, see §5 for the real behavior of this call |
| `sessionCapabilities.{close,resume,additionalDirectories}` | present | advertised but **intentionally unused** — Phase 1 design (see design spec) chose not to implement `session/resume`/`session/close` based on real-client prior art (Zed implements them for real; acp-ui, an independent third-party client, implements neither). Not a gap; a scoped decision. |
| `extensions["jarvis-bridge/steer"]` | **absent** | `supportsSteer = false` for Claude, same mechanism as opencode's absence — confirmed |
| `authMethods` | **empty array** | already pre-authenticated when the probe ran; does not mean "no auth needed" in general — see §4 |

No `fs` capability is advertised or needed by Claude (same as opencode — it never calls `fs/read_text_file`/`fs/write_text_file`; it has its own file tools).

---

## 4. Auth

Confirmed via live probe, refining the earlier static-source-analysis-only understanding:

- The adapter has **no** `authMethods` entries when the underlying `claude` CLI (or the user-specified
  `CLAUDE_CODE_EXECUTABLE`) is already logged in — `initialize` just succeeds silently.
- There is **no API-key-env-var-first path**: setting `ANTHROPIC_API_KEY` does not appear anywhere in
  the probed adapter behavior. The adapter is designed around a real, interactively-authenticated
  `claude` CLI (`~/.claude`, or `CLAUDE_CONFIG_DIR`).
- **`CLAUDE_CODE_EXECUTABLE`** is a real, working escape hatch (confirmed, not just inferred from
  source): point it at any working `claude` binary and the adapter shells out to it instead of its own
  bundled native binary. This is also the fix for the arm64/Rosetta issue in §1.
- Per the Feb 2026 OAuth policy research from the initial brainstorm (see conversation history / design
  spec background), this CLI-delegation model is why jarvis-bridge integrating with the official adapter
  is a materially different case from embedding a raw OAuth token in an unrelated harness — the adapter
  always drives a real `claude` CLI process, it does not extract or forward bearer tokens itself.

**Operational note:** `agents.json`'s Claude profile should set `env.CLAUDE_CODE_EXECUTABLE` to the
result of `which claude` (or leave it unset and require the SDK's own bundled binary to work — only
safe on non-Rosetta hosts, see §1) rather than relying on the bundled binary unconditionally.

---

## 5. Session lifecycle

### `session/new`

**Request:** `{ "cwd": "<absolute path>", "mcpServers": [] }` — same as opencode.

**Response** (verbatim, `full` scenario):
```json
{
  "sessionId": "de499309-4956-400e-9cc3-6d1372449b63",
  "modes": {
    "currentModeId": "auto",
    "availableModes": [
      { "id": "auto", "name": "Auto", "description": "Use a model classifier to approve/deny permission prompts" },
      { "id": "default", "name": "Manual", "description": "Standard behavior, prompts for dangerous operations" },
      { "id": "acceptEdits", "name": "Accept Edits", "description": "Auto-accept file edit operations" },
      { "id": "plan", "name": "Plan Mode", "description": "Planning mode, no actual tool execution" },
      { "id": "dontAsk", "name": "Don't Ask", "description": "Don't prompt for permissions, deny if not pre-approved" },
      { "id": "bypassPermissions", "name": "Bypass Permissions", "description": "Bypass all permission checks" }
    ]
  },
  "configOptions": [
    { "id": "mode", "name": "Mode", "category": "mode", "type": "select", "currentValue": "auto", "options": [ "...six options mirroring availableModes..." ] },
    { "id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": "sonnet", "options": [ { "value": "default", "name": "Default (recommended)" }, { "value": "sonnet", "name": "Sonnet" }, "...opus, haiku, fable..." ] },
    { "id": "effort", "name": "Effort", "category": "thought_level", "type": "select", "currentValue": "default", "options": [ "default, low, medium, high, xhigh, max" ] },
    { "id": "agent", "name": "Agent", "type": "select", "currentValue": "default", "options": [ "default plus whatever subagents are registered locally" ] }
  ]
}
```

**Confirmed:** this exactly matches the shape Task 9's `parseSessionConfig` was built to capture — a
separate `modes` object (permission mode) plus a flat `configOptions[]` that *also* duplicates the mode
as one of its entries (`id: "mode"`), alongside `model`, `effort`, and `agent`. No mapping change needed.

**Default mode is `"auto"`, not `"default"`.** This has a real behavioral consequence: in `auto` mode, a
model classifier approves/denies tool calls **internally** — `session/request_permission` is **never
called** for ordinary tool use. It only fires once the session mode is changed to `"default"` (Manual)
via `session/set_mode`. Don't assume every Claude-backed session will route permission decisions to the
UI; most won't, unless the user (or jarvis-bridge) switches modes.

### `session/set_mode` (new outgoing method vs. opencode)

**Request:** `{ "sessionId": "...", "modeId": "default" }` — confirmed working; switches the session out
of `auto` classifier-approval into per-call `session/request_permission` prompts.

### `session/list`

**⚠️ Confirmed gap, fixed in this task:** Claude's `session/list` returns the user's **entire session
history across every project on their machine**, not scoped to the `cwd` this ACP connection was spawned
with. A live call against this machine's real `~/.claude` returned dozens of sessions from unrelated
projects (`subconcio`, `nvidia_hackathon`, etc.), each with its own `cwd` field. Before this fix,
`AcpAgentBackend.listSessions()` returned this list verbatim — meaning jarvis-bridge's "Past Chats" UI
and the `DELETE /chat/sessions/:id` fan-out (`registry.deleteSession` → `findSession` →
`listSessions()`) would have exposed and potentially targeted a user's entire unrelated Claude Code
history, not just sessions created through jarvis-bridge. **Fixed** in `AcpAgentBackend.listSessions()`
(`src/agent/acp/index.ts`): results are now filtered to `s.cwd === this.cfg.cwd || s.cwd === undefined`
(the `undefined` branch keeps opencode's behavior unchanged, since opencode doesn't report `cwd` per
session and already scopes server-side). Regression test:
`src/agent/acp/index.test.ts` → `AcpAgentBackend.listSessions — cwd scoping`.

### `session/delete`

Confirmed working for a session with prior prompt activity. **Confirmed gap, fixed in this task:**
calling `session/delete` on a session that was created via `session/new` but never had a `session/prompt`
turn (never persisted to disk) returns a JSON-RPC error shaped like:
```json
{ "code": -32603, "message": "Internal error", "data": { "details": "Session <id> not found in any project directory" } }
```
The useful detail (`"not found"`) is nested under `error.data.details`, not the top-level `message`
(`"Internal error"`). `src/server.ts`'s `DELETE /chat/sessions/:id` route classifies 404 vs 501 vs 500
purely by substring-matching `err.message`, so this generic message would have produced a **500** for
what is really a 404 case. **Fixed** in `AcpAgentBackend.deleteSession()`: catches `AcpRequestError` and
folds `data.details` into the thrown `Error`'s message when present, before it reaches the route's
classifier. Regression test: `src/agent/acp/index.test.ts` → `AcpAgentBackend.deleteSession` →
`"folds error.data.details into the thrown message (Claude's error shape)"`.

### `session/cancel`

Not separately exercised in this probe; unchanged from the existing implementation (fire-and-forget
notification), same as opencode.

---

## 6. Streaming turn (`session/prompt` → `session/update`)

**Prompt request:** `{ "sessionId": "...", "prompt": [ { "type": "text", "text": "..." } ] }` — same
shape as opencode.

**Streaming notifications observed** (`params.update.sessionUpdate` discriminator — same envelope
shape as opencode, `{ sessionId, update: {...} }`):

| `sessionUpdate` | Carries | Notes |
|---|---|---|
| `agent_message_chunk` | `content: {type:"text", text}`, `messageId` | matches opencode / existing mapping |
| `tool_call` | `toolCallId`, `title`, `kind` (`execute`/`other`/…), `status:"pending"`, `rawInput: {}`, `content: []`, plus `_meta.claudeCode.toolName` (extra, currently ignored by `mapping.ts` — harmless) | matches existing `acpUpdateToPatches` handling |
| `tool_call_update` | `status` progression, `rawInput`, `rawOutput`, `content[]` (nested `{type:"content", content:{type:"text",text}}`), plus `_meta.claudeCode.toolResponse` (extra, ignored) | matches existing handling — `rawInput`/`rawOutput` are top-level on `update`, as the current code expects |
| `usage_update` | **two distinct shapes**: (a) live context window `{used, size}` (sometimes with `_meta._claude/rateLimit`) — same shape family as opencode's `{used,size,cost}`; (b) none directly — the authoritative per-turn usage is only in the *final result*, not a `usage_update` notification, for Claude | `usageFromAcp` correctly returns `null` for shape (a) alone (all four core fields absent/zero) and emits no spurious patch — confirmed no change needed |
| `available_commands_update` | `availableCommands: [{name, description}, ...]` | fires once per session, same as opencode; on this probe it returned the *local* user's full skill/slash-command list (a lot of entries — this is a property of running under the real `claude` CLI with the user's own config, not a jarvis-bridge concern) |
| `session_info_update` | `title`, `updatedAt` | falls through `mapping.ts`'s existing `default:` no-op case, same as opencode — confirmed harmless |

### `_meta._claude/rateLimit` — subscription usage windows (confirmed 2026-07-15)

`usage_update` notifications triggered by the SDK's `rate_limit_event` (infrequent — only fires when
quota status changes, not every turn) carry `_meta["_claude/rateLimit"]` alongside the usual
`used`/`size`. Confirmed shape from a live `.logs/<sessionId>.log` capture:
```json
{
  "status": "allowed",
  "resetsAt": 1783957200,
  "rateLimitType": "five_hour",
  "overageStatus": "rejected",
  "overageDisabledReason": "org_level_disabled",
  "isUsingOverage": false
}
```

Two gotchas found building the InfoPanel "Usage" card (`RateLimitWindow` in `src/agent/types.ts`,
extraction in `mapping.ts`'s `rateLimitFromMeta`/`usageFromAcp`):

- **`resetsAt` is Unix epoch *seconds*, not milliseconds** — despite every other timestamp-shaped field
  in this codebase being ms. Passing it straight to `new Date(...)` silently lands on Jan 1970 (this
  shipped once and was caught from a screenshot, not a test). `rateLimitFromMeta` normalizes by `* 1000`
  at ingestion so `RateLimitWindow.resetsAt` is honestly epoch-ms everywhere downstream — don't
  reintroduce the bare passthrough.
- **`utilization` is not always present.** The JSON above (a real `status: "allowed"` event) has no
  `utilization` key at all. Claude appears to only include it once you're closer to a threshold
  (unconfirmed whether `allowed_warning`/`rejected` always include it). `InfoPanel.tsx` falls back to
  rendering the bare `status` text when `utilization` is absent — that's correct/expected, not a bug.

**Not currently reachable: the richer `get_usage` control API.** The SDK also exposes an
actively-queryable `SDKControlGetUsageRequest`/`SDKControlGetUsageResponse` (`subtype: "get_usage"`, see
`@anthropic-ai/claude-agent-sdk`'s `sdk.d.ts`) — this is what backs the CLI's own `/usage` command and
reliably returns `utilization: number | null` per window regardless of status. `claude-agent-acp` never
calls or forwards it (confirmed by reading its `acp-agent.ts` source, 2026-07-15) — it only wires up the
passive `rate_limit_event`. There is no ACP-level way to reach `get_usage` today; always-populated
utilization would require patching the upstream `claude-agent-acp` package to call `query.getUsage()`
and forward the response — out of scope for jarvis-bridge itself, left as a known gap (see §11).

**Final `session/prompt` result** (verbatim, trivial prompt):
```json
{
  "stopReason": "end_turn",
  "usage": {
    "inputTokens": 2,
    "outputTokens": 4,
    "cachedReadTokens": 17002,
    "cachedWriteTokens": 14983,
    "totalTokens": 31991
  }
}
```

**Confirmed:** `inputTokens`, `outputTokens`, `cachedReadTokens`, `cachedWriteTokens` all match
`AcpUsageShape`'s existing accepted keys in `src/agent/acp/mapping.ts:227-245` exactly (camelCase, as
already coded — not the snake_case alternates). `totalTokens` has no dedicated field in `AcpUsageShape`;
`UsageTotals` derives its own total from the four component fields already captured, so no field was
dropped. **No mapping.ts changes needed** — the earlier static analysis was correct here.

---

## 7. Agent → client callbacks

| Callback | Fires on Claude? | Shape confirmed | Notes |
|---|---|---|---|
| `session/request_permission` | **Yes**, but only in `default` mode (see §5) — never in the default `auto` mode | `{ options: [{kind, name, optionId}], sessionId, toolCall: {...} }` | **See the `optionId` vs `kind` correction below — this is the most important finding in this doc.** |
| `elicitation/create` | **Yes**, when `AskUserQuestion` is invoked *and* `clientCapabilities.elicitation.form` was advertised at `initialize` | `{ mode: "form", sessionId, toolCallId, message, requestedSchema: {type:"object", properties: {question_0: {oneOf:[{const,title,description}, ...]}, question_0_custom: {...}}} }` | See §9 for the elicitation-advertisement decision |
| `fs/read_text_file` / `fs/write_text_file` | **No** — same as opencode, Claude has its own file tools | n/a | safe to omit handlers, matches opencode's doc |

### ⚠️ Corrected: `optionId` ≠ `kind` — real bug fixed by this probe

`docs/archives/implementation/02-acp-backend.md` (line 214) instructed replying to an auto-approved
permission request with the literal `optionId: "allow_once"`. That value was carried directly into
`src/agent/acp/index.ts`'s auto-approve path as a hardcoded string. It happens to be correct for
opencode (whose real `optionId` values apparently equal their `kind` names) but **is wrong for Claude**.
The real `session/request_permission` options captured from a live "write a file" prompt in `default`
mode:
```json
{
  "options": [
    { "kind": "allow_always", "name": "Always Allow all Write", "optionId": "allow_always" },
    { "kind": "allow_once",   "name": "Allow",                   "optionId": "allow" },
    { "kind": "reject_once",  "name": "Reject",                   "optionId": "reject" }
  ]
}
```
`kind` is the ACP-defined, stable vocabulary (`allow_once`/`allow_always`/`reject_once`/…); `optionId` is
**agent-defined and opaque** — Claude's `"allow_once"`-kind option has `optionId: "allow"`, not
`"allow_once"`. Auto-approving on the previous hardcoded-`optionId` code path against a real Claude
backend would have sent an `optionId` matching none of the offered options.

**Fixed:** the auto-approve branch in `src/agent/acp/index.ts` (`session/request_permission` handler)
now selects by `kind === "allow_once"` (falling back to `"allow_always"`, then the first option, then the
literal `"allow_once"` string if `options` is empty/absent — preserving old behavior for callers that
don't send `options` at all). Regression test: `src/agent/acp/index.test.ts` →
`AcpAgentBackend — auto-approve permission selection`.

**UI-routed (non-auto-approve) approvals were already correct** — `routeApprovalToUI` already forwards
the real `optionId` values from the options array to the frontend and back (`src/agent/acp/index.ts:276`
maps `o.optionId` through untouched), so manual approve/deny in the UI works correctly for Claude without
any change.

---

## 8. Elicitation (`AskUserQuestion`)

Live-tested both branches of the design spec's open question — "does dropping the `elicitation`
capability from `clientCapabilities` make `AskUserQuestion` gracefully degrade to an ordinary
`session/request_permission` flow, or does it break?":

- **With `clientCapabilities.elicitation.form` advertised** (today's behavior): `AskUserQuestion` is
  available to the model, fires a real `elicitation/create` request (shape above). At the time of the
  original probe, the stub handler replied `{ action: "cancel" }` unconditionally; the tool call
  completed with `status: "failed"`, `rawOutput: "Tool permission request failed: Error: Tool use
  aborted"`, and the model gracefully recovered in its next text chunk (no hang, no protocol error) —
  e.g. *"The question was sent but got aborted before you could respond."*
- **With `elicitation` omitted from `clientCapabilities`:** `AskUserQuestion` is **not offered to the
  model at all**. Asked to use it, the model responded: *"There's no AskUserQuestion tool available in
  this environment — it's not among the tools I have access to here,"* then fell back to asking the
  question as plain text. This does **not** match the "degrades to `session/request_permission`"
  hypothesis from the design spec — it removes the tool entirely, which is strictly worse than the
  auto-cancel behavior above (the model at least attempts the structured tool and recovers gracefully
  with elicitation advertised; without the capability, structured multi-choice questions are
  unavailable at all).

**Decision (per plan Task 11 Step 4):** keep advertising `clientCapabilities: { elicitation: { form: {} } }`
unconditionally, exactly as today.

**Update (2026-07-15): real elicitation handling shipped.** `elicitation/create` with `mode: "form"` now
routes to the UI instead of auto-cancelling — see `src/agent/acp/index.ts`'s `routeElicitationToUI`
(mirrors `routeApprovalToUI`) and `src/agent/acp/mapping.ts`'s `elicitationSchemaToFields`, which
normalizes `requestedSchema` into generic `ElicitationField[]` (`oneOf` → `select`, `array` with
`items.anyOf` → `multi-select`, everything else → `text`) — deliberately shape-agnostic to
`AskUserQuestion` specifically, so any ACP backend's form elicitation renders the same way. The frontend's
`ElicitationModal.tsx` renders the fields; Submit resolves `POST /chat/elicitation` with
`{action:"accept", content}`, Skip resolves `{action:"decline"}`. Any `mode` other than `"form"` (MCP
dialogs, `refusal_fallback_prompt`) still falls back to `{action:"cancel"}` — those remain deferred, see
`docs/claude-acp-future-phases.md`. Full implementation notes: `docs/archives/2026-07-15-elicitation-support.md`.

---

## 9. Usage — reconciliation summary

No `UsageTotals`/`mapping.ts` field additions were needed (see §6). This differs from the opencode
binding doc, which needed `cost`/`thoughtTokens` additions — Claude's final-result usage shape is a
strict subset of fields already handled.

---

## 10. Probe transcript (reference)

Captured 2026-07-13 at `/tmp/claude-acp-probe/probe.jsonl` (ephemeral, not committed — re-run to
reproduce) using a throwaway Node driver script (`AcpConnection`-equivalent hand-rolled client, since the
plan's suggested approach of driving the adapter by hand over a second terminal was replaced with a
scripted driver for reproducibility). Five scenarios, distinguished by a `scenario` field on every logged
line:

| Scenario | What it covered |
|---|---|
| `full` | `initialize` → `session/new` → trivial prompt → tool-call (Bash) prompt |
| `elicit-on` | `initialize` with `elicitation` advertised → `AskUserQuestion` prompt |
| `elicit-off` | `initialize` **without** `elicitation` → `AskUserQuestion` prompt |
| `permission` | `session/set_mode("default")` → a file-write prompt, to force a real `session/request_permission` (default `auto` mode never fires it) |
| `session-lifecycle` | `session/list` (revealed the global-history gap, §5) → `session/delete` on a never-prompted session (revealed the error-shape gap, §5) |

**Required environment note for reproduction:** must set `CLAUDE_CODE_EXECUTABLE` (see §1) and run under
a native Node build matching the host's real architecture — do not assume a Rosetta hang means auth is
broken.

Re-run this probe after any adapter or `claude` CLI upgrade before treating this doc as current.

---

## 11. Known gaps / open questions

- **`session/list` global scope (fixed, this task):** see §5. Filtering by `cwd` is a client-side
  mitigation; there is no server-side (adapter) option to scope `session/list` by cwd that this probe
  found. If a future adapter version adds one, prefer it over client-side filtering.
- **`session/delete` on unpersisted sessions (fixed, this task):** deleting a session that was created
  but never prompted now correctly surfaces as 404 rather than 500. Still slightly surprising from a UX
  angle — a user who opens "new chat" and immediately deletes it without sending anything will hit this
  path. No further action needed; 404 is the correct, harmless outcome.
- **Auto-approve `optionId` selection (fixed, this task):** see §7. Worth double-checking if opencode
  ever changes its own `optionId` convention — the fix is now kind-based and agent-agnostic, so it
  should be safe regardless.
- **Real elicitation handling (form mode):** shipped 2026-07-15, see §8. MCP-server-initiated dialogs
  and `refusal_fallback_prompt` remain deferred per `docs/claude-acp-future-phases.md`.
- **`session/resume`/`session/close`:** advertised by Claude but intentionally unimplemented per the
  Phase 1 design decision — no change from that decision as a result of this probe.
- **arm64/Rosetta hang (documented, not a code fix):** see §1. This is a deployment/environment note for
  whoever runs jarvis-bridge with the Claude backend on Apple Silicon with a Rosetta-built Node — not
  something jarvis-bridge's own code can detect or work around beyond documenting
  `CLAUDE_CODE_EXECUTABLE` as the fix.
- **Subscription rate-limit `utilization` not always populated (documented, not fixed):** see §6. The
  passive `rate_limit_event` the adapter forwards can omit `utilization` (only `status`/`resetsAt`); the
  richer `get_usage` control API that always includes it is not exposed by `claude-agent-acp`. The
  InfoPanel "Usage" card falls back to showing the bare status text in that case — working as intended.
  Fixing this for real would mean patching the upstream `claude-agent-acp` package, deliberately not
  pursued for now (decided 2026-07-15).
