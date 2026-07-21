# codeg — Exploration Notes

**Source:** `~/Desktop/opensource/codeg` (xintaofei/codeg)
**Local checkout:** in active development
**What it is:** Multi-agent coding workspace (Tauri 2 desktop + standalone Axum server).
Aggregates Claude Code, Codex, OpenCode, Gemini CLI, Cline, Hermes, CodeBuddy, Kimi,
Pi, Grok into one workspace.

---

## Summary

- **Stack:** Tauri 2, Next.js 16 (static export), React 19, SeaORM, SQLite,
  `sacp`/`sacp-tokio`, Axum, portable PTY.
- **Three Rust binaries from one crate:**
  - `codeg` — Tauri desktop app
  - `codeg-server` — standalone Axum server
  - `codeg-mcp` — per-session MCP companion
- **Shared core architecture:** Tauri and server modes call the same business functions;
  HTTP handlers and Tauri commands are thin wrappers over transport-neutral services.
- **One process + state machine per active agent session.** `ConnectionManager` owns a
  map from internal UUID → `AgentConnection`.
- **Resume/load/new chain:** `session/resume` (if advertised) → `session/load` (on
  failure) → `session/new` (recoverable load failures).
- **`session/load` replay is drained, not used for history rendering.** Historical UI
  content comes from native transcript parsers.

## Worth borrowing

| # | Pattern | Reference | Why for jarvis_bridge |
|---|---------|-----------|----------------------|
| A | **Per-agent subprocess with bounded dedup lock** | `src-tauri/src/acp/manager.rs:107-123, 385-423` | Per-`(agent, cwd, session_id)` lock prevents duplicate subprocesses from simultaneous browser tabs / reconnects. |
| B | **Resume reuse only when sessionID, agent, cwd, status all match** | `src-tauri/src/acp/manager.rs:601-647` | Avoids stale-state attachments. |
| C | **RAII cleanup guard for connections** | `src-tauri/src/acp/connection.rs:183-211` | Removes stale entries even if connection task panics. |
| D | **Two-layer prompt concurrency** | `src-tauri/src/acp/connection.rs:226-232`, `manager.rs:649-707, 821-860` | `prompt_lock` serialises conversation-linking/DB writes/command enqueue; `turn_in_flight` rejects a second prompt while ACP turn is running. |
| E | **Cancel as compare-and-set** | `src-tauri/src/acp/manager.rs:1160-1215` | Cancel transition cannot overwrite a turn that completed just before the click. |
| F | **Idle connection sweep** | `src-tauri/src/acp/manager.rs:477-550` | Backend sweeps connected-not-prompting-not-waiting-for-permission-no-background-work connections older than timeout. Frontend keeps open-tab connections alive separately. |
| G | **Native-session aggregation via parsers** | `src-tauri/src/parsers/mod.rs:154-177, 390-429` | Every supported agent has a parser implementing `AgentParser`. Deduplicated by `(agent_type, external_id)`. Historical content read from agent's native store. |
| H | **Config fingerprint per connection** | `src-tauri/src/acp/connection.rs:234-245`, `manager.rs:552-599` | Settings changes compare against fingerprint; emit "restart to apply" state instead of pretending subprocess was reconfigured. |
| I | **Typed internal bus + serialized external bus** | `src-tauri/src/web/event_bridge.rs:73-147`, `app_state.rs:20-26` | `InternalEventBus` uses typed `Arc<EventEnvelope>` for in-process consumers. `WebEventBroadcaster` serialises JSON for transport-bound consumers. |
| J | **DB projection outside hot path** | `src-tauri/src/acp/lifecycle.rs:1-72, 117-165` | DB writes moved off event-emission hot path. Only selected low-frequency lifecycle events reach per-connection DB workers. Retries transient SQLite errors. |
| K | **Subscribe-with-snapshot WebSocket protocol** | `src-tauri/src/web/ws_attach.rs:38-54, 123-195` | Client attaches to a connection with optional sequence cursor. Server atomically picks: full snapshot, small replay batch, or snapshot fallback. Holds session-state read lock while snapshotting. |
| L | **Bounded replay ring** | `src-tauri/src/acp/event_stream.rs:8-30, 117-159, 323-452` | 128 KiB total, 128 events, 64 KiB max per event. Oversized events clear replay buffer and force snapshot fallback. Event-size estimator avoids serializing huge images while holding state lock. |
| M | **Ownership-aware cross-client attachment** | `src/contexts/acp-connections-context.tsx:3761-3805, 4001-4055` | Viewer observes and controls shared session but must detach rather than disconnect. |
| N | **Separated high-frequency and low-frequency event planes** | `src-tauri/src/web/event_bridge.rs:149-282, 405-428` | Per-connection ACP events carry tokens + tools. Global side channels carry conversation membership, folder updates, tab snapshots. Status changes bridge centrally. |
| O | **Transport-independent core APIs** | `src/lib/api.ts:116-315`, `src/lib/transport/index.ts:27-62` | Same command names work through Tauri and HTTP because frontend API wrappers call a transport abstraction. |
| P | **Sequence-cursor dedup on envelope arrival** | `src/contexts/acp-connections-context.tsx:3365-3384` | Incoming envelopes deduped by `seq` before reducer + subscriber fan-out. |
| Q | **Cold snapshot synthesis from authoritative state** | `src/contexts/acp-connections-context.tsx:3387-3425` | On reconnect, synthesize recent events from authoritative in-memory state. |
| R | **Delegation: child ACP sessions correlated with parent tool calls** | `src-tauri/src/acp/delegation/broker.rs:1855-2050`, `commands/conversations.rs:409-485` | Tool-call correlation via `_meta.tool_use_id` or `(agent_type, task, requested_working_dir)` FIFO fallback. Persists `parent_id`/`parent_tool_use_id`/`delegation_call_id`. |
| S | **Tool-call dedup per shell snapshot** | opencode's ACP event handler (`packages/opencode/src/acp/event.ts:281-317`) | Tracks shellSnapshots/toolStarts to avoid re-emitting duplicate `tool_call_update` for unchanged bash output. |
| T | **Three-tool name + arity scan → permission pattern** | opencode `tool/shell.ts:91-126, 415` + `permission/arity.ts:163` | tree-sitter-parsed bash AST → per-command arity → pre-populated always-allow scope. |
| U | **Auth via Bearer token in `Sec-WebSocket-Protocol`** | `src-tauri/src/web/auth.rs:9-19, 21-45` | Same trick as acp-ui's `bearer.<token>` subprotocol entry. |

## Worth knowing about

- **Single-process, local-host oriented server mode.** Active ACP sessions live in memory;
  delegation uses local UDS/named pipes; subprocesses run on server host; workspace paths
  refer to server/container filesystem. Horizontal scaling would need external session
  registry.
- **Native-session parser per agent** (Claude, Codex, OpenCode, Gemini, OpenClaw, Cline,
  Hermes, CodeBuddy, Kimi, Pi, Grok). Reusable trait `AgentParser`. OpenCode parsed
  from its SQLite DB read-only.
- **Workspace model:** folder entity (path, branch, default agent, ordering, color,
  worktree parent). Hidden chat workspace for folderless chat mode (`FolderKind::Chat`).
- **File workspace keyed by absolute normalized path** — survives folder removal.
- **`notify` watcher** with monotonic sequence + replay/snapshot. Reference-counted
  shared watchers; distinguishes full-tree/Git subscribers from paths-only file-tab
  subscribers.
- **Git worktree flows** for parallel agent work — no semantic merge algorithm, instead
  encourages worktree isolation. File saves use etag/mtime validation; external changes
  raise compare/reload/save-copy workflows.
- **MCP quirks per agent:** OpenClaw rejects MCP entries, Pi accepts but drops them,
  Hermes/Kimi/Grok read native MCP config and skip duplicate wire forwarding.

## Deployment

- 3-stage Dockerfile: build Next export, build `codeg-server` + `codeg-mcp`, copy into
  runtime image.
- Container runs at port 3080 with `/data` volume.
- `--supervise` process relaunches workers + roll-back failed upgrades.
- Env: `CODEG_PORT`, `CODEG_HOST`, `CODEG_TOKEN`, `CODEG_DATA_DIR`, `CODEG_STATIC_DIR`,
  `CODEG_MCP_BIN`.

## Specific file references (deep dive starting points)

- `src-tauri/src/acp/manager.rs` — ConnectionManager
- `src-tauri/src/acp/connection.rs` (~2700 lines) — `AgentConnection`, RAII guard,
  resume/load/new chain, MCP forwarding
- `src-tauri/src/acp/lifecycle.rs` — DB projection outside hot path
- `src-tauri/src/acp/event_stream.rs` — bounded replay ring with size estimator
- `src-tauri/src/acp/registry.rs` — agent distribution types (Npx / Binary / Uvx)
- `src-tauri/src/parsers/` — per-agent native-session parsers
- `src-tauri/src/web/router.rs` — Axum router mapping Tauri commands to HTTP
- `src-tauri/src/web/ws_attach.rs` — subscribe-with-snapshot WebSocket protocol
- `src-tauri/src/web/event_bridge.rs` — typed internal bus + serialized external bus
- `src-tauri/src/web/auth.rs` — Bearer token in WebSocket subprotocol
- `src-tauri/src/acp/delegation/broker.rs` — async delegation broker with tool-use-ID
  correlation
- `src/contexts/acp-connections-context.tsx` — frontend live event reducer + sequence
  cursor dedup
- `src/stores/conversation-runtime-store.ts` — persisted / optimistic / streaming phases