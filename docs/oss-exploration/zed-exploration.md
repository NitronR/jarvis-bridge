# zed — Exploration Notes

**Source:** `~/Desktop/opensource/zed` (zed-industries/zed)
**Local checkout:** main branch, 237 crates
**What it is:** High-performance multiplayer code editor (Rust + GPUI). Native agent
(`crates/agent/`) AND external ACP support (`crates/agent_servers/`). GPL-3.0-or-later.

---

## Summary

- **Workspace structure:** bottom-up dependency stack — `gpui` → `util`, `text`, `rope`,
  `sum_tree` → `language`, `project`, `workspace` → `editor`, `agent`, `acp_thread`,
  `collab` → `zed` (binary).
- **GPUI framework:** `Entity<T>` / `WeakEntity<T>` model with strict aliasing rules.
  Foreground executor (single UI thread, `!Send`) + BackgroundExecutor (multi-thread I/O).
  All state mutation on one thread; cross-thread work via message passing.
- **Two-track agent architecture:** native `NativeAgent` + external agents via ACP.
- **WASM extension system:** `.wit` + wit-bindgen + wasmtime + custom-section versioning.

## Worth borrowing

| # | Pattern | Reference | Why for jarvis_bridge |
|---|---------|-----------|----------------------|
| A | **Single `Connection` abstraction** | `crates/rpc/src/conn.rs` | Everything — tungstenite, axum WS, length-prefixed stdio — adapts to this single type. `Peer::add_connection` runs same I/O loop regardless. **Highest-leverage pattern for jarvis_bridge.** |
| B | **`AgentConnection` trait with capability traits** | `crates/acp_thread/src/connection.rs:91` | Defines `agent_id()`, `telemetry_id()`, `new_session()`, `load_session()`, `close_session()`, `resume_session()`, `prompt()`, `cancel()`, `authenticate()` + optional capability traits. Capability-driven selection, no `kind` enum. |
| C | **`AgentServer` trait** | `crates/agent_servers/src/agent_servers.rs:50` | `agent_id()`, `connect()`, plus optional `default_mode`, `default_config_option`, `favorite_config_option_value_ids`. Capability-driven selection. |
| D | **Subprocess spawn with `ShellBuilder::new(...).non_interactive()`** | `crates/agent_servers/src/acp.rs:796-855` | Canonical pattern for spawning external agent. Three piped streams: stdin (commands), stdout (responses/notifications), stderr (logs). |
| E | **JSON-RPC over stdio via `Lines` transport** | `crates/agent_servers/src/acp.rs:888-900` | Line-delimited JSON via `futures::sink::unfold` (outgoing) + `BufReader::lines()` (incoming). Wire format identical to ACP. |
| F | **RefCount-based pending-sessions pattern** | `crates/agent_servers/src/acp.rs:1147-1282` | `open_or_create_session` handles pending load in flight, existing session, fresh load. `Shared<Task>` + `ref_count` ensure cleanup correctness. **Directly addresses the bug class AGENTS.md flags for jarvis_bridge ACP session load.** |
| G | **Session registered in `this.sessions` BEFORE load RPC** | `crates/agent_servers/src/acp.rs:1162-1165` | Notifications dispatched during history replay can find the thread. Critical ordering requirement that AGENTS.md mandates reading first. |
| H | **Generic debug-log hook at transport** | `crates/agent_servers/src/acp.rs:152-224, 877-898` | `AcpDebugLog` keeps ring buffer (`MAX_DEBUG_BACKLOG_MESSAGES = 2000`) of every JSON-RPC message. `tapped_incoming`/`tapped_outgoing` `inspect` closures sit OUTSIDE the JSON-RPC layer — **no call site can bypass**. Matches jarvis's `.logs/<sessionId>.log` exactly. |
| I | **Foreground dispatch queue for `!Send` handlers** | `crates/agent_servers/src/acp.rs:268-386, 963` | Handler closures must be `Send`, but work must run on `!Send` foreground thread. Bridges via `mpsc::UnboundedSender<ForegroundWork>` drained by `dispatch_task` running in foreground executor. |
| J | **`observe_global::<T>(...)` pub/sub** | `crates/agent_servers/src/acp.rs:471-481`, `crates/settings/src/settings_store.rs` | Wires `cx.observe_global::<SettingsStore>` subscription so changes propagate to live agent sessions. For Node: an `EventEmitter` on a singleton settings object. |
| K | **Capability-driven, no `kind` enum** | `crates/acp_thread/src/connection.rs:108, 231, 255` | `AgentConnection::model_selector(...)` returns `Option<Rc<dyn AgentModelSelector>>`. `AgentConnection::session_list(...)` returns `Option<Rc<dyn AgentSessionList>>`. Same principle as jarvis `AgentCapabilities`. |
| L | **Bounded incoming + unbounded outgoing mpsc** | `crates/rpc/src/peer.rs:125-132` | "Use an unbounded channel so application code can always send without yielding. For incoming, use bounded channel so other peers receive backpressure." `INCOMING_BUFFER_SIZE = 256`. Recipe worth copying verbatim. |
| M | **`Peer::request_dynamic` request-response correlation** | `crates/rpc/src/peer.rs:458, 466, 272` | Each request gets `next_message_id`, registered in `response_channels: HashMap<msg_id, oneshot::Sender>`. Incoming responses route by `responding_to`. |
| N | **Stream requests via mpsc + terminal `EndStream`/`Error`** | `crates/rpc/src/peer.rs:489-573` | `request_stream` → `request_stream_dynamic` — unbounded `mpsc::Sender` per stream-id. Terminal frames remove channel. Uses `util::defer` for cleanup if consumer drops. |
| O | **`zstd`-compressed binary frames over WebSocket** | `crates/rpc/src/message_stream.rs:41-62` | `COMPRESSION_LEVEL = 4` in prod, `-7` in tests. All envelopes zstd-encoded. `MAX_BUFFER_LEN = 1 MiB`. Significant bandwidth savings for chat traffic. |
| P | **`TypeIdHashMap` dispatch** | `crates/rpc/src/proto_client.rs:24, 50, 90-131, 150` | `AnyProtoClient` wraps `Arc<State>`. `ProtoMessageHandlerSet` dispatches by `TypeId`. For TypeScript: discriminated union dispatch by `message.type` with `assertNever` exhaustiveness. |
| Q | **Lamport-timestamped operations + custom CRDT** | `crates/text/src/operation_queue.rs:5-50` | `Operation` trait + `OperationQueue<T>` backed by `SumTree<OperationItem<T>>`. Sorted by Lamport timestamp, deduped. Equivalent to simplified Yjs/Automerge. Useful for chat history where message ordering matters. |
| R | **Channel pool pub/sub** | `crates/collab/src/rpc/connection_pool.rs:188-253` | `ChannelPool` with bidirectional indexes `by_user: HashMap<UserId, HashMap<ChannelId, ChannelRole>>` + `by_channel: HashMap<ChannelId, HashSet<UserId>>`. O(1) subscribe/unsubscribe, O(N) broadcast. |
| S | **`SettingsStore` merge-on-write** | `crates/settings/src/settings_store.rs:145-168` | Single `merged_settings: Rc<SettingsContent>` source of truth. All reads are `Rc` clone. Writes are O(n) in number of settings but rare. Re-merges on every change. |
| T | **Versioned schema migration via `version` field** | `crates/agent/src/legacy_thread.rs:24, 50-76` | `SerializedThread::from_json` matches on `version` and dispatches to `SerializedThreadV0_1_0::upgrade(self)`. Pattern: keep upgrade chain as sequence of structs with `upgrade()` methods, one per historical version. |
| U | **`util::defer` — RAII cleanup on scope exit** | `crates/rpc/src/peer.rs:156-168` | Drop-based cleanup that runs on early return from `?` AND on panic. For Node: try/finally equivalent, but Rust version more concise. |
| V | **`with_timeout` on RPC requests** | `crates/rpc/src/proto_client.rs:308, 333-334` | Each RPC gets a deadline via the executor. Cleaner than JS's `Promise.race` against `setTimeout`. Returns `Result<Ok | CancelledDueTimeout | ChannelDropped>`. |
| W | **`FlattenAcpResult` trait** | `crates/agent_servers/src/acp.rs:248-266` | Collapses doubly-nested `Result<Result<T, anyhow::Error>, anyhow::Error>` into flat `Result<T, acp::Error>`. Comments note: anyhow downcasts typed errors like `auth-required` back out. |
| X | **`ShellBuilder::new(...).non_interactive()` for cross-platform** | `crates/agent_servers/src/acp.rs:838` | `non_interactive()` flag handles TTY detection, sets env to suppress prompts. Pairs with cygpath / WSL detection (opencode `tool/shell.ts:355-362`). |
| Y | **SumTree — B-tree with cached aggregates** | `crates/sum_tree/src/sum_tree.rs:18, 34, 95-100` | `TREE_BASE = 6` in prod. Each item has `Summary` + multiple `Dimensions` (Line, Char, Utf16, Offset). O(log n) seek to "the message at offset N". |
| Z | **Multi-task dispatch pattern for terminal output** | `crates/agent_servers/src/acp.rs:902-917` | `stderr_task = cx.background_spawn(async move { read stderr line-by-line, log it })`. Foreground never blocks on stderr. |

## Worth knowing about

- **WASM extension system** (`.wit` + wit-bindgen + wasmtime + custom-section versioning).
  `crates/extension_host/` is ~1100 lines of host-side loader. Versioned via 6-byte
  `zed:api-version` custom section. Extensions register handlers via `register_extension!`
  macro. **`chdir` stub returns `ENOSUP`** — security boundary like `pathGuard.ts`.
- **`sqlez` SQLite wrapper** with `SQLITE_OPEN_NOMUTEX` + `RefCell` so writes serialize
  through foreground (`crates/sqlez/src/connection.rs:18, 51`). Avoids cross-thread
  SQLite locking.
- **Workspace persistence engine** at `crates/workspace/src/persistence.rs` (5953 lines)
  — closest analog to jarvis's `sessionConfigStore`. Uses `SessionWorkspace` model with
  `SerializedProjectGroup`, `SerializedWorkspaceLocation` (Local vs. Remote).
- **Multi-task per-ACP-connection with stream response channels.** Request id allocator
  is `Arc<AtomicU32>` per connection (NOT global) — `crates/rpc/src/peer.rs:70, 466`.
  Same placement principle: per-connection ID generation prevents contention.
- **`mpsc::UnboundedSender<MainThreadCall>`** for extensions requesting foreground work
  (`crates/extension_host/src/wasm_host.rs:60`). Same bridge pattern as ACP `ForegroundWorkItem`.
- **`actix_server` rejected in favour of `axum`** for collab server (Zed's choice).
- **Workspace tree watcher** uses `notify` crate with monotonic sequence + snapshot/replay.
- **Terminal:** Two-layer architecture. `alacritty_terminal` underneath with
  `FairMutex<Term>` for concurrent render reads + exclusive writes. GPUI-side adapter in
  `crates/terminal/src/terminal.rs` (4947 lines).
- **PTY event listener pattern:** `ZedListener` is thin `EventListener` forwarding
  `AlacTermEvent`s to `UnboundedSender<PtyEvent>`. GPUI side observes via async_channel.
- **Connection guard with backpressure at upgrade phase.** `MAX_CONCURRENT_CONNECTIONS = 512`
  checked BEFORE handshake (`crates/collab/src/rpc.rs:95-106, 1248-1258`). Returns 503
  if exceeded.
- **WebSocket protocol version negotiation** via `ProtocolVersion` header against
  `rpc::PROTOCOL_VERSION = 68`. Stale clients get `StatusCode::UPGRADE_REQUIRED`.
- **Connection cascading-cleanup:** `remove_connection` removes from `connected_users`
  AND cascades `channels.remove_user(&user_id)` if no other connection for that user
  remains (`crates/collab/src/rpc/connection_pool.rs:82-94`).
- **App version + release channel headers** required for WS upgrade — production hardening.
- **`request_stream`** mpsc keyed by request-id with `EndStream` and `Error` payload
  types as terminal markers — direct mapping to WS gateway streaming.

## Differences from jarvis_bridge

| Aspect | zed | jarvis_bridge |
|---|---|---|
| Language | Rust | TypeScript / Node |
| UI framework | GPUI (native) | React (web) |
| Multiplayer | First-class (collab server) | Not implemented |
| Concurrent connections | 512 with backpressure | Single-process, no explicit limit |
| MCP support | Yes | Yes |
| ACP | Yes (client + native) | Yes (client only) |
| WASM extensions | Yes (wasmtime + WIT) | No |
| Terminal | alacritty + GPUI | xterm.js or equivalent (per AGENTS.md) |
| Settings store | Multi-source merge-on-write | `sessionConfigStore` (single workspace) |

## Specific file references (deep dive starting points)

- `crates/rpc/src/conn.rs` — single `Connection` abstraction
- `crates/rpc/src/peer.rs` (1371 lines) — wire-level protocol
- `crates/rpc/src/message_stream.rs` — zstd compression + framing
- `crates/rpc/src/proto_client.rs` — TypeId dispatch
- `crates/collab/src/rpc.rs` (4196 lines) — production WebSocket server
- `crates/collab/src/rpc/connection_pool.rs` — connection pool + cascading cleanup
- `crates/agent_servers/src/acp.rs` (5020 lines) — closest analog to jarvis stack
- `crates/agent_servers/src/agent_servers.rs` — `AgentServer` trait
- `crates/acp_thread/src/connection.rs` — `AgentConnection` trait
- `crates/acp_thread/src/acp_thread.rs` (10,055 lines) — full thread/timeline model
- `crates/agent/src/agent.rs` (6925 lines) — native agent implementation
- `crates/agent/src/legacy_thread.rs` — versioned schema migration
- `crates/agent/src/thread_store.rs` — thread persistence
- `crates/settings/src/settings_store.rs` — multi-source settings merge
- `crates/extension_host/src/wasm_host.rs` (1110 lines) — WASM extension loader
- `crates/extension_api/src/extension_api.rs` — extension API + register_extension! macro
- `crates/terminal/src/alacritty.rs` (1104 lines) — terminal adapter
- `crates/terminal/src/terminal.rs` (4947 lines) — GPUI terminal entity
- `crates/sum_tree/src/sum_tree.rs` (1903 lines) — foundational data structure
- `crates/text/src/operation_queue.rs` — Lamport-timestamped operations
- `crates/gpui/src/app/entity_map.rs` (1278 lines) — Entity<T> model
- `crates/gpui/src/executor.rs` — Task<R> + detach_and_log_err
- `crates/sqlez/src/connection.rs` — SQLite wrapper with foreground serialization
- `crates/workspace/src/persistence.rs` (5953 lines) — workspace session restoration