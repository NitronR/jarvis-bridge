# Claude ACP Backend — Phase 1 Design

**Status:** Approved (design), pending implementation plan
**Date:** 2026-07-12

## Context

jarvis_bridge is a generic ACP *client*/gateway (`src/agent/acp/*`) that spawns any
ACP-speaking agent CLI as a subprocess and speaks JSON-RPC over stdio. It already
supports opencode as its one and only backend, chosen at startup via `AGENT_CMD`/
`AGENT_ARGS`. The agent-agnostic wire contract is documented in
`docs/archives/implementation/02-acp-backend.md`; opencode's concrete wire shapes are
pinned in `docs/archives/implementation/10-agent-opencode.md`. (The `implementation/`
directory has been archived in full — it documents the original from-scratch
re-implementation and is retained for historical reference, not as a living spec.)

We evaluated Anthropic/Zed's official ACP adapter for Claude
(`@agentclientprotocol/claude-agent-acp`, formerly `@zed-industries/claude-code-acp`,
cloned to `~/Desktop/opensource/claude-code-acp/` for source analysis) as a second
backend. Source analysis (see prior conversation for full file:line detail) found
several structural differences from opencode's binding: CLI-delegated auth instead of
an env-var API key, a split `modes`/`configOptions` model instead of opencode's flat
`configOptions[]`, a new `plan` sessionUpdate kind for TODO/task lists, a different
permission option-id vocabulary, a richer session lifecycle (`resume`/`close`/`delete`
beyond new/load/list/fork), real elicitation usage, and native FIFO prompt queueing
instead of strict one-turn-at-a-time.

We also cross-checked two real ACP clients for lifecycle-method prior art: Zed (the
protocol's reference client, in `~/Desktop/opensource/zed/crates/agent_servers/src/acp.rs`)
implements `session/resume`/`close`/`delete` as genuine, separately-capability-gated
wire calls, with ref-counting for `close` to support multiple editor panes sharing one
session. acp-ui (`~/Desktop/opensource/acp-ui/`, an independent third-party client that
also ships Claude Code as a default agent) calls **none of the three** — its "Resume
Sessions" feature is `session/load` under a friendlier label, and its "Delete session"
is purely local list bookkeeping with no ACP call at all. jarvis_bridge's simpler
single-session-per-conversation model (no ref-counted multi-pane sharing) is closer in
spirit to acp-ui, informing the lifecycle decision below.

## Goals (Phase 1)

1. A JSON-based backend configuration (`agents.json`) listing named agent profiles,
   replacing the single hardcoded `AGENT_CMD`/`AGENT_ARGS` pair as the source of truth
   for *available* backends.
2. A Settings-page control for the **default backend** (persisted separately from the
   static profile list), used to select which configured backend new sessions use.
   Per-session backend selection is **not** built now — the underlying architecture
   supports it later, but no UI for it ships in Phase 1.
3. `AgentBackend`/`AgentSession`/`BackendPool` extended to hold multiple live backend
   kinds concurrently, addressed by name.
4. Claude (`claude-agent-acp`) wired in as a second backend at **opencode-equivalent
   parity**: chat streaming, tool calls, permissions, slash commands, usage, session
   list/load/fork, healthcheck.
5. `session/delete` implemented for real (Zed's pattern: call it, then let the client
   refresh its session list) — this is the one lifecycle addition beyond opencode
   parity, since it has genuine destructive value and no ref-counting complexity.
6. A new binding-profile doc, `docs/agent-claude-code.md`, mirroring
   `docs/archives/implementation/10-agent-opencode.md`, backed by a live probe capture
   (not static source reading) for anything not already confirmed via source citation.
7. All new backend-selection behavior stays **capability-driven**: `mapping.ts`/
   `index.ts` never branch on a hardcoded backend "kind" string. Every behavioral
   difference is derived from what the agent advertises at handshake (extending the
   existing pattern already used for `supportsSteer`/`canFork`).

## Non-goals (Phase 1) — see `docs/claude-acp-future-phases.md`

- The `plan`/TODO `ChatPatch` variant and its UI.
- Real elicitation handling beyond the existing always-cancel stub, **except** the
  probe-driven decision on whether to advertise `clientCapabilities.elicitation.form`
  at all (see Open Items below — this is an auth/config decision, not new elicitation
  code).
- The terminal-streaming `_meta` channel for Bash tool output.
- Visible `session/set_mode` / `session/set_config_option` pickers in the frontend.
- Per-session backend picker UI.
- In-app Claude login flow (Phase 1 requires a pre-authenticated host `~/.claude`
  credential store, set up via a normal `claude` CLI login done outside jarvis_bridge).

## Architecture

### Config: `agents.json`

New file, repo root by default, path overridable via `JARVIS_BRIDGE_AGENTS_CONFIG`.
Static list of named backend profiles, hand-edited like `.env`:

```json
{
  "backends": [
    { "name": "opencode", "kind": "opencode", "command": "opencode", "args": ["acp"], "env": {} },
    { "name": "claude", "kind": "claude-acp", "command": "npx", "args": ["-y", "@agentclientprotocol/claude-agent-acp@latest"], "env": {} }
  ]
}
```

`kind` is a label used only for logs and to select which binding-profile doc applies —
**never** a runtime branch condition in `mapping.ts`/`index.ts`.

Claude's spawn config prefers a locally-installed `claude-agent-acp` binary on `PATH`
(`which claude-agent-acp`) before falling back to `npx -y ...@latest`, mirroring
opencode's binding-doc resolution pattern (avoids an npx cold-start once the package is
installed globally). `CLAUDE_CONFIG_DIR` is an optional pass-through in the profile's
`env` block for non-default credential store locations.

### Default backend setting

Kept separate from the static profile list, in a small runtime-mutable
`~/.jarvis-bridge/settings.json`, following the existing auto-approve pattern (env
seeds the initial value, runtime can override without a restart):

- `JARVIS_BRIDGE_DEFAULT_BACKEND` env var seeds the initial default.
- `GET/PUT /settings/default-backend` (new endpoint) reads/persists the runtime
  override; backs the new Settings-page control.

### Backend pool → registry

Today's `createBackendPool` wraps one backend, pooled per-cwd. This becomes a registry
of `Map<backendName, BackendPool>` — one `BackendPool` per configured profile (each
still doing its existing per-cwd pooling internally), plus
`getDefaultBackendName()`/`setDefaultBackendName()` backed by `settings.json`.

- `createSession` accepts an optional `backendName` (unused by the UI in Phase 1,
  plumbed through for the future per-session picker); defaults to the current
  default-backend setting when omitted.
- `listSessions`/`findSession`/`getSession` fan out across all registered pools instead
  of assuming one.

### `AgentBackend`/`AgentCapabilities` additions (`src/agent/types.ts`)

- `sessionDelete: boolean` capability, derived from `initialize`'s
  `sessionCapabilities.delete` (same pattern as existing `canFork` reading
  `sessionCapabilities.fork`).
- Optional `deleteSession(sessionId): Promise<void>` method on `AgentBackend`; new
  `DELETE /chat/sessions/:id` HTTP route. Minimal frontend affordance: a delete action
  gated on `capabilities.sessionDelete` (shown for Claude, hidden for opencode).
- `promptQueueing: boolean` capability, derived from
  `agentCapabilities._meta.claudeCode.promptQueueing` — read the same way
  `supportsSteer` already reads the non-standard `extensions` key: still
  capability-driven, not a `kind === "claude"` check.
  - When `true`: relax the per-session busy gate. Instead of rejecting a second
    `sendMessage` while one is in flight, enqueue it (FIFO, per session) and let the
    adapter's native queueing handle ordering. Each queued caller gets its own
    `AsyncIterable<ChatPatch>` that begins draining once its turn is dequeued.
  - When `false` (opencode): unchanged — strict reject-if-busy, regression-covered by
    existing tests.
- Model/mode config parsing in `createSession`/`loadSession` generalizes to read
  `configOptions[]` generically (works for both agents — different `id` values per
  agent: `model` for opencode; `model`/`effort`/`agent`/`fast` for Claude) and
  additionally captures a `modes` field when present. Phase 1 stores this data (no
  dropped fields) without exposing new pickers — that's Phase 2.

### Session lifecycle: resume/close/delete decision

- **`session/resume`**: not implemented. Folded into `loadSession()` — real-world
  precedent (acp-ui) does exactly this in production, and Zed's own capability gate
  falls back gracefully when the method is absent.
- **`session/close`**: not implemented. Zed's ref-counted close exists to support
  multiple editor panes sharing one session; jarvis_bridge's existing
  subprocess/pool-level teardown already covers cleanup for its simpler
  one-session-per-conversation model.
- **`session/delete`**: implemented for real (see above) — the one lifecycle addition
  with genuine user-facing value and no ref-counting complexity, following Zed's
  pattern (call the ACP method, then let the client refresh its session list).

## Claude-specific binding details

- **Auth**: no API-key env var. The adapter reads Claude Code's own credential store
  (`~/.claude`, or `CLAUDE_CONFIG_DIR` if overridden) written by a normal `claude` CLI
  login done by the user outside jarvis_bridge. Healthcheck-failure hint updated to
  point at running that login, mirroring the existing generic auth-failure guidance.
- **Handshake/capability negotiation**: identical code path to opencode — no
  special-casing. `canFork` reads `sessionCapabilities.fork` (present for both, though
  Claude's is internally named `unstable_forkSession` — a version-drift risk to note in
  the binding doc). `supportsSteer` reads `extensions` (absent for both — no steer for
  Claude either). `promptQueueing` reads the new `_meta.claudeCode.promptQueueing` key.
- **Tool-call kind vocabulary**: Claude reports kinds opencode never does (`think`,
  `switch_mode`, `fetch`, `search`, `execute`). Before calling Phase 1 done, confirm the
  frontend's kind→icon/label map falls back gracefully on unknown kinds.
- **Permission option ids**: Claude uses `allow`/`reject` vs opencode's
  `allow_once`/`reject_once`. No code change needed — `routeApprovalToUI` already
  treats `options[]` generically by id/name/kind — but `02-acp-backend.md`'s example
  payload is opencode-specific and should be corrected/annotated in the new binding doc.

## Open items — resolve via live probe, not static-source guessing

Run the real adapter against a pre-authenticated `~/.claude`, capture the transcript
(mirroring `docs/archives/implementation/10-agent-opencode.md`'s
`/tmp/opencode-probe/probe.jsonl` method), and cite it directly in
`docs/agent-claude-code.md`:

1. Exact `usage_update` / final `session/prompt` result field names.
2. Exact `session/prompt` request shape.
3. Whether `fs/read_text_file`/`fs/write_text_file` are ever actually invoked (opencode
   never calls them despite advertising `fs`; not yet confirmed either way for Claude).
4. Whether to advertise `clientCapabilities.elicitation.form` in Phase 1 at all: source
   analysis suggests `AskUserQuestion` tool calls may route through the ordinary
   permission-request path (already handled generically) when elicitation is **not**
   advertised, versus being silently auto-cancelled via the always-cancel stub when it
   **is** advertised. Test both ways; pick whichever degrades better with zero new
   code, rather than assuming the worse path.

## Testing plan

- `backendPool.test.ts` extended: multi-backend registry (several named pools),
  default-backend resolution, cross-pool `listSessions`/`findSession`/`getSession`.
- New coverage for `settings.json` persistence (env-seeded default, runtime override
  via the new endpoint).
- `mapping.test.ts`/session-config tests extended: generalized `configOptions[]`/
  `modes` parsing against both opencode's flat shape and Claude's split shape.
- `index.test.ts` extended: busy-gate behavior forks two ways — strict reject when
  `promptQueueing` is false (regression coverage for opencode), FIFO enqueue-and-drain
  when true (new, Claude).
- New route tests for `DELETE /chat/sessions/:id` and the settings endpoint.

## Manual verification (before calling Phase 1 done)

Run jarvis_bridge with Claude set as the default backend; drive a real chat turn with a
tool call, an approval prompt, a session delete, and a default-backend switch back to
opencode — confirming the capability-driven design holds up in practice, not just in
unit tests.

## Docs plan

- `docs/agent-claude-code.md` — new living binding-profile doc (not under
  `docs/archives/`, since `implementation/` is retired but this is current reference
  material, same tier as `docs/acp-notes.md`).
- `docs/claude-acp-future-phases.md` — roadmap of everything explicitly deferred (see
  Non-goals above), so Phase 2 can pick it up without re-deriving scope. Forward-looking
  planning doc — routed through `plannotator annotate` before being declared final, per
  standing workflow rules.
- After Phase 1 implementation lands: revisit whether any other `docs/` file needs a
  refresh, and consider a dated `docs/archives/` entry summarizing the phase.
