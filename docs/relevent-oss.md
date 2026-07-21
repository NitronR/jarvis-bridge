# Relevant Open-Source Projects — Overview Index

Survey of ACP-adjacent and editor projects in `~/Desktop/opensource/`, with notes on
patterns that could be borrowed or adapted when building features for `jarvis_bridge`.

Detailed notes live in `oss-exploration/`, one file per repo:

| Project | Path | Source |
|---------|------|--------|
| acp-ui (cross-platform ACP client, Vue + Tauri) | [oss-exploration/acp-ui-exploration.md](./oss-exploration/acp-ui-exploration.md) | `~/Desktop/opensource/acp-ui` |
| claude-agent-acp (Claude SDK → ACP adapter) | [oss-exploration/claude-agent-acp-exploration.md](./oss-exploration/claude-agent-acp-exploration.md) | `~/Desktop/opensource/claude-agent-acp` |
| codeg (multi-agent Tauri + Axum workspace) | [oss-exploration/codeg-exploration.md](./oss-exploration/codeg-exploration.md) | `~/Desktop/opensource/codeg` |
| opencode (upstream AI coding agent — our reference) | [oss-exploration/opencode-exploration.md](./oss-exploration/opencode-exploration.md) | `~/Desktop/opensource/opencode` |
| zed (Rust editor with native + external ACP support) | [oss-exploration/zed-exploration.md](./oss-exploration/zed-exploration.md) | `~/Desktop/opensource/zed` |

For cross-cutting patterns that appear in multiple projects, see
[oss-exploration/cross-cutting.md](./oss-exploration/cross-cutting.md).

---

## What each project is

- **acp-ui** — Vue 3 + Tauri 2 cross-platform ACP **client** (desktop, mobile, web).
  Wraps Claude Code, Gemini CLI, OpenCode, etc. into a unified chat UI. ~7,167 lines.
- **claude-agent-acp** — Official ACP adapter that wraps the Claude Agent SDK.
  Published as `@agentclientprotocol/claude-agent-acp`. ~6,500-line core.
- **codeg** — Multi-agent coding workspace (Tauri 2 + standalone Axum server). Three
  Rust binaries from one crate: `codeg` (Tauri), `codeg-server` (Axum), `codeg-mcp`
  (per-session MCP companion). In active development.
- **opencode** — Open-source AI coding agent; the **upstream** of `jarvis_bridge`.
  `opencode acp` is the reference integration tested by jarvis.
- **zed** — High-performance multiplayer code editor (Rust + GPUI). 237 crates.
  Native agent + external ACP support. GPL-3.0-or-later.

## Top 3 cross-cutting patterns to know about

(Detailed entries in [cross-cutting.md](./oss-exploration/cross-cutting.md).)

1. **Transport-agnostic ACP client with explicit `Connection` interface.**
   Lets the same protocol code drive stdio, WebSocket, and length-prefixed stdio. The
   highest-leverage pattern in the survey — directly applicable to extending jarvis's
   `AcpConnection`.

2. **Capability-driven agent selection, no `kind` enum.**
   `AgentCapabilities` flags on each backend profile. Already mandated by jarvis
   `AGENTS.md` for `backendRegistry.ts`.

3. **Generic per-session JSON-RPC log hook at the transport.**
   `tapped_incoming`/`tapped_outgoing` closures sit OUTSIDE the JSON-RPC layer — no
   call site can bypass. Matches jarvis's existing `.logs/<sessionId>.log` pattern.

## Local checkout notes

- **codeg** is in active development; line numbers in exploration notes may drift.
- **opencode** is upstream of jarvis and moves fast; V1/V2 migration is in progress.
- **zed**'s `crates/acp_thread/src/acp_thread.rs` (10,055 lines) is the full
  thread/timeline model — not yet deep-dived; consider follow-up if chat features planned.
- **acp-ui** v0.1.16 has no terminal drawer. **No OSS project surveyed has both
  multi-agent orchestration AND a user-driven terminal drawer** — that combination
  appears jarvis-specific.

Per AGENTS.md, the **Worth borrowing** patterns in each exploration file should be
re-validated against current jarvis code before adoption.