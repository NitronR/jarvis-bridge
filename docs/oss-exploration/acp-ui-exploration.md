# acp-ui — Exploration Notes

**Source:** `~/Desktop/opensource/acp-ui` (formulahendry/acp-ui)
**Local checkout:** v0.1.16, ~7,167 lines
**What it is:** Cross-platform ACP **client** (Vue 3 + Tauri 2). Desktop, mobile, and web
builds from one codebase. Wraps agents from Claude Code, Gemini CLI, OpenCode, etc.,
into a unified chat UI.

---

## Summary

- **Frontend:** Vue 3.5 Composition API, Pinia 3, Vue Router, Vite 6, TypeScript strict.
- **Backend:** Tauri 2 (Rust) for desktop/mobile; pure browser bundle for web.
- **ACP SDK:** `@agentclientprotocol/sdk` v0.13.
- **Dual-targeting trick:** same Vue source compiles to Tauri (full stdio + fs) and a
  static web bundle (websocket-only, localStorage). Backend-feature gating centralised
  in `src/lib/host/index.ts` with deferred `await import('@tauri-apps/api/...')` so the
  web bundle never pays for Tauri code.
- **11 default agents** pre-configured in `agents.json` (`src-tauri/src/config.rs:80-193`).

## Worth borrowing

| # | Pattern | Reference | Why for jarvis_bridge |
|---|---------|-----------|----------------------|
| A | **Transport abstraction** (`AcpTransport` interface) | `src/lib/transport/types.ts:10-29` | Lets the same ACP client drive stdio + WebSocket. Bridge is already transport-agnostic. |
| B | **NDJSON frame splitting** | `src/lib/transport/websocket.ts:152-174` | A single WS message may contain multiple `\n`-delimited JSON frames because stdio↔WS bridges forward agent stdout verbatim. If jarvis exposes stdio agents over WS, use NDJSON or single-frame explicitly. |
| C | **Pending-request maps with disconnect-rejection** | `src/lib/acp-bridge.ts:58-61, 81-97, 257-302` | Per-request resolver/rejecter maps, 60-second timeout, reject-all-on-close safety net. Compare with jarvis `src/agent/acp/jsonrpc.ts`. |
| D | **Foreground reconnect state machine** | `src/stores/session.ts:879-917`, `src/App.vue:46-62` | 250ms debounce on `visibilitychange`/`pageshow`/`online`. Three UI-distinct states: initial connect, reconnect, user-initiated resume. |
| E | **WebSocket subprotocol as bearer token** | `src/lib/transport/websocket.ts:277-294` | Browser WS APIs can't set custom HTTP headers; encode `Authorization: Bearer <token>` as `bearer.<token>` subprotocol entry. |
| F | **Heartbeat below the bridge** | `src/lib/transport/websocket.ts:186-217` | `$/ping` every 25s, kept inside transport so it never appears in traffic log. Targets shortest common idle-timeout window (NAT/devtunnel/nginx all use ~60s). |
| G | **Subprocess spawning with shell login flags** | `src-tauri/src/agent.rs:115-166` | Probe `$SHELL`, pick `-l` for bash/zsh/ksh, no flag for fish, fall back to `/bin/sh`. Uses `shell_escape::escape` for safety. |
| H | **Platform detection without Tauri plugins** | `src/lib/platform.ts:24-86` | `navigator.userAgent` (works inside Tauri webviews), `__TAURI_INTERNALS__` global check. Cheaper than Rust-side platform-detect IPC. |
| I | **Auth/permission Promise+ref pattern** | `src/stores/session.ts:258-285, 443-479` | `promptForAuthMethod` returns a Promise resolved by the dialog. Inverts "callback → UI" into "Promise → UI". |
| J | **`agents.json` with `IndexMap`** | `src-tauri/src/config.rs:75-193` | Preserve insertion order for stable UI display. |
| K | **Defense-in-depth transport validation** | `src-tauri/src/lib.rs:128-200`, `src/lib/host/index.ts:70-103` | Validate config schema identically in both Rust and TS. IPC boundary catches misbehaving renderer. |
| L | **Config hot-reload via `notify` crate** | `src-tauri/src/config.rs:332-368` | Watch config directory non-recursively, emit `config-changed` event on Modify/Create. Frontend listener updates Pinia. |
| M | **`connectionAborted` flag + multi-checkpoint cancellation** | `src/stores/session.ts:73, 316-360, 535-547, 758-782` | `spawnedInstance` set pre-bridge so abort can kill orphans. Multi-stage cancellation with checkpoints. |
| N | **Idempotent `close()` + synthesised close event** | `src/lib/transport/websocket.ts:245-266` | Uses `queueMicrotask` if browser elides the real close event. |

## Worth knowing about

- **No terminal drawer.** There is no `xterm.js`/PTY integration. All file system work
  goes through ACP `fs/read_text_file` / `fs/write_text_file`. This is a notable
  contrast with jarvis's terminal drawer.
- **No auto-reconnect by design** (`websocket.ts:13-19`). Auto-reconnect would desync
  session state because ACP sessions are per-connection; instead, surfaces close and
  presents manual "Reconnect".
- **Capability-driven reconnect:** `tryReconnect()` only fires if
  `currentSession.supportsLoadSession` is true (`session.ts:421, 879-917`).
- **Session persistence** uses a `loadKvStore('sessions.json')` adapter over
  `@tauri-apps/plugin-store` (Tauri) or `localStorage` (web).

## Differences from jarvis_bridge

| Aspect | acp-ui | jarvis_bridge |
|---|---|---|
| Frontend framework | Vue 3 + Pinia | React + Vite |
| Desktop wrapper | Tauri 2 | None — pure HTTP/WS gateway |
| Mobile/web | First-class | None (gateway only) |
| Terminal drawer | Not present | Present |
| Transport | stdio + WebSocket | stdio only |
| Logging | Pinia store, in-memory, capped 500 entries | Per-session JSONL in `.logs/` |
| Auto-approve | Not implemented | `sessionConfigStore` (backend + per-session) |
| Session resume | `session/load` if agent supports it | Same |

## Specific file references (deep dive starting points)

- `src/lib/acp-bridge.ts` (49-443) — `AcpClientBridge` implementing SDK `Client` interface
- `src/lib/transport/types.ts:10-29` — transport interface
- `src/lib/transport/websocket.ts` — WS transport with NDJSON framing
- `src/lib/transport/stdio.ts` — Tauri stdio transport
- `src/lib/transport/index.ts:20-59` — transport factory
- `src/stores/session.ts` (968 lines) — heart of the app
- `src/stores/traffic.ts` + `TrafficMonitor.vue` — JSON-RPC frame logger
- `src-tauri/src/agent.rs` — subprocess manager with shell login flag probing
- `src-tauri/src/config.rs:75-193` — `AgentsConfig` with `IndexMap`
- `src-tauri/src/config.rs:332-368` — `notify` crate config watcher