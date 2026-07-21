# OSS Exploration — Cross-cutting patterns

This is a summary of the strongest patterns that appear across multiple of the surveyed
projects (acp-ui, claude-agent-acp, codeg, opencode, zed). These are the highest-leverage
candidates for adoption in `jarvis_bridge` if/when implementing new features.

For per-project details, see the individual exploration files in this directory.

---

## 1. Transport-agnostic ACP client with explicit `Connection`/`AcpTransport` interface

**Appears in:** acp-ui, zed, opencode

- **acp-ui:** `src/lib/transport/types.ts:10-29` — `AcpTransport` interface with stdio,
  WebSocket, http factory.
- **zed:** `crates/rpc/src/conn.rs` — single `Connection` type that adapts tungstenite,
  axum WS, length-prefixed stdio. `Peer::add_connection` runs same I/O loop regardless.
- **opencode:** `packages/opencode/src/acp/` — splits into `service.ts` (protocol
  handlers), `session.ts` (gateway metadata), `event.ts` (replay). Bridge is
  transport-agnostic.

**For jarvis_bridge:** lets the gateway expose stdio agents over WS to browser clients
with zero protocol-layer changes. **Highest-leverage pattern in the survey.**

## 2. Capability-driven agent selection, no `kind` enum

**Appears in:** zed, opencode

- **zed:** `AgentConnection` trait (`crates/acp_thread/src/connection.rs:91`) and
  `AgentServer` trait (`crates/agent_servers/src/agent_servers.rs:50`). Optional
  capability traits returned as `Option<Rc<dyn ...>>`.
- **opencode:** `acp/service.ts` — capability checks drive wire behavior (terminal
  output, terminal auth, elicitation forms, boolean config options, gateway auth).

**Already mandated** by jarvis `AGENTS.md` for `backendRegistry.ts`.

## 3. Generic per-session JSON-RPC log hook at the transport

**Appears in:** acp-ui, zed, opencode (via existing jarvis `AcpConnection`)

- **acp-ui:** `stores/traffic.ts` + `TrafficMonitor.vue` — Pinia store capped at 500
  entries.
- **zed:** `AcpDebugLog` (`crates/agent_servers/src/acp.rs:152-224`) — ring buffer
  (`MAX_DEBUG_BACKLOG_MESSAGES = 2000`). `tapped_incoming`/`tapped_outgoing` `inspect`
  closures sit OUTSIDE the JSON-RPC layer — no call site can bypass.
- **opencode:** logs events through `sdk.global.event` SSE stream.

**Already implemented** in jarvis at `src/agent/acp/jsonrpc.ts` per AGENTS.md.

## 4. RefCount-aware pending-sessions

**Appears in:** zed

- **zed:** `open_or_create_session` (`crates/agent_servers/src/acp.rs:1147-1282`) —
  handles three cases: pending load in flight, existing session, fresh load.
  `Shared<Task>` + `ref_count` pair on `PendingAcpSession` and `AcpSession`.

**Already documented** in jarvis AGENTS.md as the model to follow for ACP session load.

## 5. WebSocket subprotocol as bearer token

**Appears in:** acp-ui, codeg

- **acp-ui:** `src/lib/transport/websocket.ts:277-294` — `bearer.<token>` subprotocol
  entry.
- **codeg:** `src-tauri/src/web/auth.rs:9-19, 21-45` — `Sec-WebSocket-Protocol:
  bearer.<token>`.

**Pattern:** browser WS APIs can't set custom HTTP headers; encode auth as WS subprotocol
entry.

## 6. Bounded incoming + unbounded outgoing channels

**Appears in:** zed

- **zed:** `crates/rpc/src/peer.rs:125-132` — `INCOMING_BUFFER_SIZE = 256`. Comment:
  "Use an unbounded channel so application code can always send without yielding. For
  incoming, use bounded channel so other peers receive backpressure."

**Recipe worth copying verbatim** for jarvis WS layer.

## 7. Foreground dispatch queue for `!Send` handlers

**Appears in:** zed

- **zed:** `crates/agent_servers/src/acp.rs:268-386, 963` — `ForegroundWorkItem` trait +
  `enqueue_request`/`enqueue_notification` bridges `Send` handler closures onto `!Send`
  foreground thread. `mpsc::UnboundedSender<ForegroundWork>` drained by `dispatch_task`.

**For jarvis_bridge:** not directly applicable (Node is single-threaded), but the
pattern of "central dispatcher that all events flow through" maps to a single
`EventEmitter` or a `Promise.resolve()` chained event handler.

## 8. Tagged errors → `RequestError` conversion

**Appears in:** opencode, claude-agent-acp, zed

- **opencode:** `packages/opencode/src/acp/error.ts` (90 lines) — `ACPError.toRequestError`
  maps each `ACPError.Error` → ACP `RequestError` with right variant (`invalidParams`,
  `authRequired`, `methodNotFound`, `internalError`).
- **claude-agent-acp:** `RequestError` for protocol-meaningful failures (`invalidParams`,
  `resourceNotFound`, `authRequired`, `internalError`). Synthetic Claude messages like
  "Please run /login" converted to `authRequired` (`src/acp-agent.ts:736-767`).
- **zed:** `FlattenAcpResult` trait + `acp::Error::from` downcasting
  (`crates/agent_servers/src/acp.rs:248-266`).

**For jarvis_bridge:** convert `ClaudeError`/`OpenCodeError` to ACP `RequestError` with
appropriate variant in `src/agent/acp/mapping.ts`.

## 9. Lamport-timestamped / sequenced event streams with bounded replay

**Appears in:** zed, codeg

- **zed:** `OperationQueue` with `SumTree` (`crates/text/src/operation_queue.rs:5-50`).
- **codeg:** `event_stream` ring buffer (`src-tauri/src/acp/event_stream.rs:8-30`) +
  sequence-cursor dedup on envelope arrival (`src/contexts/acp-connections-context.tsx:3365-3384`).
- **opencode (V2):** `seq`-based cursor pagination (`packages/core/src/session.ts:296-329`).

**For jarvis_bridge:** optional, but useful if multiple clients subscribe to one session.

## 10. Config hot-reload via filesystem watch

**Appears in:** acp-ui, claude-agent-acp

- **acp-ui:** `notify` crate watches `agents.json` non-recursively
  (`src-tauri/src/config.rs:332-368`). Emits `config-changed` event; frontend listener
  updates Pinia.
- **claude-agent-acp:** `SettingsManager` resolves and watches `~/.claude/settings.json`,
  project `.claude/settings.json`, etc. Directory-based watching + 100ms debounce
  (`src/settings.ts:115-165`).

**For jarvis_bridge:** jarvis's `agents.json` is loaded at startup. Hot-reload would
mirror the acp-ui `config-changed` event pattern.

## 11. Shell subprocess spawning with login-shell flags

**Appears in:** acp-ui, zed, opencode

- **acp-ui:** `src-tauri/src/agent.rs:115-166` — probe `$SHELL`, pick `-l` for
  bash/zsh/ksh, no flag for fish, fall back to `/bin/sh`. Uses `shell_escape::escape`.
- **zed:** `ShellBuilder::new(...).non_interactive()` (`crates/agent_servers/src/acp.rs:838`).
  `non_interactive()` flag handles TTY detection, sets env to suppress prompts.
- **opencode:** `tool/shell.ts:91-126` uses `web-tree-sitter` + `tree-sitter-bash` to
  parse command AST for permission pre-classification.

**For jarvis_bridge:** matches what `src/agent/acp/...` likely already does for Claude
Code — useful cross-reference.

## 12. Promise+ref pattern for auth/permission flows

**Appears in:** acp-ui, claude-agent-acp, opencode

- **acp-ui:** `promptForAuthMethod` returns a Promise resolved by the dialog
  (`src/stores/session.ts:258-285, 443-479`). Inverts "callback → UI" into "Promise → UI".
- **claude-agent-acp:** SDK tool callback's `AbortSignal` is forwarded to ACP request
  cancellation. `Permission.reply` resolves the deferred. JSON-RPC request cancellation
  ↔ agent session cancellation ↔ backend query interruption ↔ permission subrequest
  cancellation.
- **opencode:** `ask()` publishes `permission.asked` event, stores `Deferred`, awaits.
  `reply()` resolves. "always" replies append to `approved: Rule[]` and immediately
  resolve other pending asks whose patterns are covered
  (`packages/opencode/src/permission/index.ts:109-117, 156-177`).

**For jarvis_bridge:** cleaner than callback-based auth UI on the React side.

---

## Bonus: Per-project unique patterns

These appear in only one project but are worth knowing about:

| Pattern | Project | Reference |
|---------|---------|-----------|
| **Lamport-timestamped operations for CRDT-like ordering** | zed | `crates/text/src/operation_queue.rs` |
| **Shadow git for filesystem snapshots** | opencode | `packages/opencode/src/snapshot/index.ts` |
| **Native-session parsers per agent** (Claude, Codex, OpenCode, Gemini, etc.) | codeg | `src-tauri/src/parsers/` |
| **Tool-call correlation via `_meta.tool_use_id` + FIFO fallback** | codeg | `src-tauri/src/acp/delegation/broker.rs` |
| **`observ_global::<T>(...)` pub/sub via globals** | zed | `crates/agent_servers/src/acp.rs:471-481` |
| **`util::defer` — RAII cleanup on scope exit** | zed | `crates/rpc/src/peer.rs:156-168` |
| **`effect_cmd` pattern for yargs + Effect** | opencode | `packages/opencode/src/cli/cmd/acp.ts:9` |
| **PTY ticket-based auth for WebSocket** | opencode | `packages/opencode/src/server/routes/instance/httpapi/groups/pty.ts` |
| **Per-instance `ScopedCache<string, A>` keyed by directory** | opencode | `packages/opencode/src/effect/instance-state.ts` |
| **Cross-instance routing via `x-opencode-directory` header** | opencode | `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts` |
| **`zstd`-compressed binary frames over WebSocket** | zed | `crates/rpc/src/message_stream.rs:41-62` |
| **`TypeIdHashMap` dispatch** | zed | `crates/rpc/src/proto_client.rs:24, 50, 90-131, 150` |
| **SumTree — B-tree with cached aggregates** | zed | `crates/sum_tree/src/sum_tree.rs:18, 34, 95-100` |
| **RAII cleanup guard for connections** | codeg | `src-tauri/src/acp/connection.rs:183-211` |
| **Two-layer prompt concurrency** (`prompt_lock` + `turn_in_flight`) | codeg | `src-tauri/src/acp/connection.rs:226-232`, `manager.rs:649-707` |
| **Cancel as compare-and-set** | codeg | `src-tauri/src/acp/manager.rs:1160-1215` |
| **Idempotent `close()` + synthesised close event** | acp-ui | `src/lib/transport/websocket.ts:245-266` |
| **3-platform-output capability negotiation** | claude-agent-acp | `src/acp-agent.ts:956-1104` |
| **Heartbeat below the bridge** | acp-ui | `src/lib/transport/websocket.ts:186-217` |
| **Pending-request maps with disconnect-rejection** | acp-ui | `src/lib/acp-bridge.ts:58-61, 81-97, 257-302` |

---

## Open questions / things to verify locally

- **codeg** is in active development. Large files (e.g. `acp_thread.rs` at 10,055 lines
  is zed, not codeg; codeg's `connection.rs` is ~2700 lines) may have moved since these
  notes were taken.
- **opencode** is the upstream of `jarvis_bridge` and moves fast. The V1/V2 dual-write
  in `session/processor.ts` is migration in progress — re-check before adopting
  `SessionV2.Service` patterns.
- **zed**'s `crates/acp_thread/src/acp_thread.rs` (10,055 lines) is the full
  thread/timeline model — not yet explored in detail. Consider a follow-up deep-dive
  if chat features are planned.
- **acp-ui** v0.1.16 has no terminal drawer — that gap is what jarvis already addresses
  with its terminal drawer. **No OSS project surveyed has both multi-agent orchestration
  AND a user-driven terminal drawer** — that combination appears to be jarvis-specific.
- The reference docs in `docs/` should be cross-checked against current code per the
  AGENTS.md note about doc drift. This file is a survey of external projects, so it
  cannot drift against jarvis_bridge itself, but the patterns should be re-validated
  before being adopted.