# opencode — Exploration Notes

**Source:** `~/Desktop/opensource/opencode` (anomalyco/opencode)
**Local checkout:** upstream of jarvis_bridge; moves fast
**What it is:** Open-source AI coding agent — the upstream project whose `opencode acp`
mode is the reference integration tested by `jarvis_bridge`.

---

## Summary

- **Monorepo structure:** Bun workspaces, 25+ packages.
- **Key packages:**
  - `opencode` — CLI/gateway binary; runs HTTP server + ACP server
  - `core` — shared library: session core (V1/V2), database, events, tools, LLM client route
  - `llm` — provider-agnostic LLM client + `LLMEvent` schema
  - `server` — generated v2 HTTP API (Effect `HttpApi` declaration-only — schema source
    for SDK codegen)
  - `sdk/js` — generated JS client (typed fetch + SSE); `createOpencode()` spawns server
  - `plugin` — plugin interface (hooks, tools, custom tools)
  - `desktop`, `app`, `web`, `slack` — front-ends / alternative gateways
- **Build:** Bun + TypeScript strict + `tsgo --noEmit`. Turbo for orchestration. `oxlint`.
- **SDK code-gen** from Effect's `HttpApi` via `@hey-api/openapi-ts`.
- **ACP support** in `packages/opencode/src/acp/` — both sides: implements `Agent`
  interface AND consumes the agent's own HTTP API via the SDK.

## Worth borrowing

| # | Pattern | Reference | Why for jarvis_bridge |
|---|---------|-----------|----------------------|
| A | **Client-of-self pattern** | `packages/opencode/src/cli/cmd/acp.ts:1-72` | `opencode acp` starts an HTTP server in-process, creates an `OpencodeClient` against `http://localhost:<port>`, pipes stdio via `ndJsonStream` into a new `AgentSideConnection`. **The exact gateway pattern jarvis_bridge uses.** |
| B | **`AcpConnection` triple split** | `packages/opencode/src/acp/service.ts` (1048 lines), `session.ts` (231 lines), `event.ts` (342 lines) | `service.ts` is protocol method handlers. `session.ts` is in-memory parallel state for gateway-only metadata (model/variant/mode/MCP registration). `event.ts` is single subscription re-emitting agent events to all clients with replay-on-load. |
| C | **Bidirectional content adapters** | `packages/opencode/src/acp/content.ts` (250 lines) | `promptContentToParts` + `partsToContentChunks` handle `audience`/`synthetic`/`ignored` flags correctly. |
| D | **`Directory.Snapshot` cached per-cwd** | `packages/opencode/src/acp/directory.ts` (210 lines), `service.ts:718-773` | Cache per-cwd capability snapshots. Refresh on directory change. Saves redundant SDK calls. |
| E | **Tagged errors → `RequestError` conversion** | `packages/opencode/src/acp/error.ts` (90 lines) | `ACPError.toRequestError` maps each `ACPError.Error` → ACP `RequestError` with right variant (`invalidParams`, `authRequired`, `methodNotFound`, `internalError`). |
| F | **Per-session permission FIFO queue** | `packages/opencode/src/acp/permission.ts:19-42` | FIFO queue keyed by session ID ensures permission asks arrive in order when agent fires them rapidly. |
| G | **Tool-kind mapping** | `packages/opencode/src/acp/tool.ts:38-71` | Small registry mapping internal tool names → ACP `ToolKind` enum values. |
| H | **Event subscription with replay-on-load** | `packages/opencode/src/acp/event.ts:39-340` | `Subscription` class wraps `subscription.start()`. On `loadSession`, walks historical parts and emits `agent_message_chunk` / `tool_call` for each text/tool part. |
| I | **Tool-call state dedup** | `packages/opencode/src/acp/event.ts:281-317` | `shellSnapshots` and `toolStarts` track bash output that hasn't changed to avoid duplicate `tool_call_update`. |
| J | **Doom-loop detection in stream consumer** | `packages/opencode/src/session/processor.ts:519-545` | Same tool + same input `DOOM_LOOP_THRESHOLD = 3` times consecutively → asks permission before continuing. Generic safeguard outside tool implementations. |
| K | **Tool execution = `Effect` with deferred permission gating** | `packages/opencode/src/permission/index.ts:109-117, 156-177` | `ask()` publishes `permission.asked` event, stores `Deferred`, awaits. `reply()` resolves. "always" replies append to `approved: Rule[]` and immediately resolve other pending asks whose patterns are covered. |
| L | **`Tool.define(id, init)` builder with auto-truncation** | `packages/opencode/src/tool/tool.ts:99-149, 151-169` | `wrap()` compiles params decoder once, runs `truncate.output()` on every tool unless `metadata.truncated` set. Centralises output size enforcement. |
| M | **`effect_cmd` pattern for yargs + Effect** | `packages/opencode/src/cli/cmd/acp.ts:9` | Adapts yargs command to run inside Effect runtime. |
| N | **Two runtime adapters (`native` vs `ai-sdk`)** | `packages/opencode/src/session/llm.ts:226-269, 376` | `flags.experimentalNativeLlm` picks between `LLMNativeRuntime.stream` (new native over `@opencode-ai/llm`) and legacy `streamText(...)` from `ai` SDK. `LLMAISDK.toLLMEvents` normalises both to same `LLMEvent`. |
| O | **Provider config as data** | `packages/core/src/models-dev.ts`, `provider.ts` | ModelsDev is an npm-fetched JSON registry. Adding a new provider doesn't require code change. Capability metadata + costs come from data. |
| P | **Snapshot via shadow git** | `packages/opencode/src/snapshot/index.ts` | Tracks filesystem state at start of each turn via shadow git repo. Computes patch after turn. Stores as `patch` Part on assistant message. Powers "files changed" view + "revert". |
| Q | **`Plugin.trigger` as seam for system-prompt mutation** | `packages/opencode/src/plugin/index.ts:44-56` | Central pattern: invokes all hooks for named event with `input` (read-only) and `output` (mutable object). Plugins append to system prompt. Same pattern for `tool.definition`, `text.complete`, `command.execute.before`, `shell.env`. |
| R | **PTY ticket-based auth for WebSocket** | `packages/opencode/src/server/routes/instance/httpapi/groups/pty.ts` | `connect-token` endpoint issues short-lived `PtyTicket.ConnectToken` so WS URL can be opened from browser without credentials in URL. |
| S | **Cross-instance routing via `x-opencode-directory` header** | `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts` | Looks up workspace + directory from header or query, routes to right per-instance Effect scope. |
| T | **Per-instance `ScopedCache<string, A>` keyed by directory** | `packages/opencode/src/effect/instance-state.ts` (69 lines) | Registers `disposer` so cache invalidates when project disposed (HTTP connection drops, etc.). |

## Worth knowing about

- **`opencode acp` is the reference integration tested by jarvis_bridge.** Capability
  detection, NDJSON framing, model/mode negotiation all go through this path. Any
  deviation in jarvis's `src/agent/acp/mapping.ts` should be checked against
  `packages/opencode/src/acp/service.ts`.
- **Session replay ordering gotcha.** V2's `messages: Stream<SessionEvent.DurableEvent>`
  uses `seq`-based cursor pagination (`packages/core/src/session.ts:296-329`). V1 still
  uses legacy JSONL rows.
- **V1 vs V2 dual-write** in processor (`mirrorAssistant` flag,
  `packages/opencode/src/session/processor.ts:129`). Both `Message` rows and new
  `SessionEvent` durable events are persisted during migration.
- **Tool filtering per model.** `tools(model)` returns tools filtered per-model
  (`apply_patch` only for `gpt-*` non-oss non-4 models; `edit`/`write` disabled for
  those) — `packages/opencode/src/tool/registry.ts:267-307`.
- **Plugins get a typed client to the host's own HTTP API** — `packages/opencode/src/plugin/index.ts:142-147`.
  Plugins don't bypass the gateway; they call it. Falls back to in-process app dispatch
  in CLI mode.
- **Native binary resolution for bundled executables** distinguishes Linux glibc vs.
  musl (`packages/core/src/provider.ts` auth handling).

## V2 session model

- `SessionV2.Service`: `create` / `get` / `list` / `messages` / `context` / `events` /
  `prompt` / `shell` / `skill` / `compact` / `wait` / `resume` / `interrupt` /
  `switchAgent` / `switchModel`.
- `prompt()` is `Effect.uninterruptible`: admits prompt durably via
  `SessionInput.admit(...)`, then wakes execution; returns `Admitted` to caller.
- `interrupt()` publishes `InterruptRequested`, then asks execution to interrupt at that
  durable `seq` (durable interruption point).

## Session execution (V2)

- `SessionExecution.Service` — process-global, Session-ID-keyed coordinator.
  `wake(sessionID, admittedSeq)` / `interrupt(sessionID, seq?)`.
- Discovered via `SessionStore` + `LocationServiceMap.get(session.location)` only when
  a drain starts (per AGENTS.md line 152).

## Agent-side ACP method reference (per opencode's service.ts)

- `initialize` — returns protocol version 1, advertises capabilities
- `newSession` — creates session, registers MCP servers, sends `available_commands_update`
- `loadSession` — fetches session + messages, calls `restoreFromMessages` to extract
  model/variant/mode, sends `replayMessages`
- `resumeSession` — same shape but reads only last 20 messages
- `forkSession` — `sdk.session.fork(...)` then replays
- `listSessions` — paginated, merges `sdk.session.list` with in-memory live sessions
- `closeSession` — removes from in-memory map, calls `sdk.session.abort`
- `setSessionConfigOption` — handles `model`, `effort`, `mode` config option IDs
- `setSessionMode` / `setSessionModel` — dedicated setters
- `prompt` — routes by slash-command detection: `/<command>` → `sdk.session.command(...)`,
  `/compact` → `sdk.session.summarize(...)`, otherwise → `sdk.session.prompt(...)`

## Specific file references (deep dive starting points)

- `packages/opencode/src/acp/service.ts` (1048 lines) — core ACP method handlers
- `packages/opencode/src/acp/session.ts` (231 lines) — in-memory parallel state
- `packages/opencode/src/acp/event.ts` (342 lines) — SSE → ACP sessionUpdate with replay
- `packages/opencode/src/acp/permission.ts` (124 lines) — per-session FIFO queue
- `packages/opencode/src/acp/content.ts` (250 lines) — bidirectional content conversion
- `packages/opencode/src/acp/tool.ts` (367 lines) — tool-kind mapping + content builders
- `packages/opencode/src/acp/directory.ts` (210 lines) — per-cwd snapshot cache
- `packages/opencode/src/acp/error.ts` (90 lines) — tagged errors → RequestError
- `packages/opencode/src/cli/cmd/acp.ts` (73 lines) — client-of-self pattern entry point
- `packages/opencode/src/session/processor.ts` (1084 lines) — LLM stream consumer
- `packages/opencode/src/session/prompt.ts` (1707 lines) — prompt loop + slash commands
- `packages/opencode/src/session/llm.ts` — two-runtime adapter (native vs ai-sdk)
- `packages/opencode/src/tool/registry.ts` (440 lines) — built-in + plugin tools
- `packages/opencode/src/permission/index.ts` (230 lines) — glob rule evaluation
- `packages/opencode/src/permission/arity.ts` (163 lines) — bash command arity dictionary
- `packages/opencode/src/tool/shell.ts` (657 lines) — tree-sitter AST parsing for permissions
- `packages/opencode/src/snapshot/index.ts` — shadow-git filesystem snapshot
- `packages/opencode/src/server/server.ts` (225 lines) — HTTP server entry
- `packages/opencode/src/effect/instance-state.ts` — per-directory `ScopedCache`