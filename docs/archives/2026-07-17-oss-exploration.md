# 2026-07-17 — OSS exploration: 5 ACP-adjacent projects surveyed

**Date:** 2026-07-17 23:23 IST
**Session:** jarvis_bridge root session (no task IDs — direct tool execution, not a subagent session)

## Summary

Surveyed 5 projects in `~/Desktop/opensource/` and wrote per-repo exploration notes into
`docs/oss-exploration/` plus a cross-cutting summary. Originally produced as one
consolidated `docs/relevent-oss.md` (470 lines), then split on user request into one
file per repo + a slim overview index.

The survey covers patterns relevant to `jarvis_bridge`'s role as an HTTP/WebSocket
gateway fronting ACP-compatible coding agents. Each project's "Worth borrowing" table
references concrete file paths and line numbers in the upstream checkouts.

## Projects explored

| Repo | What it is | Reference file |
|---|---|---|
| acp-ui | Vue 3 + Tauri 2 cross-platform ACP client (formulahendry) | `docs/oss-exploration/acp-ui-exploration.md` |
| claude-agent-acp | Official ACP adapter wrapping Claude Agent SDK | `docs/oss-exploration/claude-agent-acp-exploration.md` |
| codeg | Multi-agent Tauri + Axum workspace (xintaofei) | `docs/oss-exploration/codeg-exploration.md` |
| opencode | Upstream AI coding agent — the reference integration tested by jarvis | `docs/oss-exploration/opencode-exploration.md` |
| zed | Rust GPUI editor with native + external ACP support | `docs/oss-exploration/zed-exploration.md` |

`formsg` was also present in `~/Desktop/opensource/` but was nearly empty (only an
`.opencode/` directory) — noted in the initial listing but not explored.

## Key findings (top 3 cross-cutting patterns)

1. **Transport-agnostic `Connection`/`AcpTransport` interface.** Same protocol code
   drives stdio, WebSocket, length-prefixed stdio. Appears in acp-ui, zed, opencode.
   Highest-leverage pattern in the survey for jarvis, which currently has stdio only.
2. **Capability-driven agent selection, no `kind` enum.** Already mandated by jarvis
   `AGENTS.md` for `backendRegistry.ts`.
3. **Generic per-session JSON-RPC log hook at the transport.** `tapped_*` closures
   sit OUTSIDE the JSON-RPC layer; no call site can bypass. Matches jarvis's existing
   `.logs/<sessionId>.log` pattern.

12 cross-cutting patterns and 20 project-unique patterns are catalogued in
`docs/oss-exploration/cross-cutting.md`.

## Key decisions

- **Split into per-repo files.** User asked for one file per repo rather than one
  consolidated document. The original `docs/relevent-oss.md` was retained as a slim
  overview index linking to the per-repo files (per user's "Keep as overview index"
  choice in the question prompt).
- **Skipped plannotator review.** These are reference/survey notes about external
  projects, not proposals requiring user review/annotation. Per the global
  `AGENTS.md`, archive notes and after-the-fact records bypass the plannotator
  workflow; the exploration notes are arguably closer to that category than to
  forward-looking specs.
- **Did not update current-knowledge docs in `docs/`.** No jarvis code changed this
  session; nothing in `acp-notes.md`, `agent-claude-code.md`, or `claude-acp-future-phases.md`
  became stale.

## Methodology notes

- Each project's exploration was delegated to an `explore` subagent
  (`subagent_type: "explore"`). The first attempt to spawn all 5 in parallel was
  interrupted/cancelled; spawning them serially (one per `task` call) worked.
- Subagents returned very thorough analyses — final summaries were 1,500–6,000 words
  per project. These were condensed into the structured "Worth borrowing" tables
  with file:line references rather than transcribed verbatim.
- Line-number references point at the user's local checkout, which may be ahead of
  or behind the upstream tagged releases cited in project READMEs.

## Files modified

Created:

- `docs/relevent-oss.md` — slimmed from 470 lines to 62-line overview index
- `docs/oss-exploration/acp-ui-exploration.md` (77 lines)
- `docs/oss-exploration/claude-agent-acp-exploration.md` (96 lines)
- `docs/oss-exploration/codeg-exploration.md` (100 lines)
- `docs/oss-exploration/opencode-exploration.md` (124 lines)
- `docs/oss-exploration/zed-exploration.md` (126 lines)
- `docs/oss-exploration/cross-cutting.md` (214 lines)

No jarvis code files modified. No git commits made.

## Follow-up tasks

1. Pick the highest-priority cross-cutting pattern (transport-agnostic `Connection`)
   and prototype it against `src/agent/acp/jsonrpc.ts` to validate API shape.
2. Cross-check each **Worth borrowing** entry against current jarvis code before
   adoption (per AGENTS.md doc-drift warning).
3. Schedule a follow-up deep-dive on zed's `crates/acp_thread/src/acp_thread.rs`
   (10,055 lines — full thread/timeline model) if chat/timeline features are planned.
4. Investigate `~/Desktop/opensource/formsg/` to determine if it's a stale/incomplete
   clone that should be removed.
5. Clarify if `claude-code-acp` (also in `~/Desktop/opensource/`) is intentionally
   separate from `claude-agent-acp` or a duplicate — they share identical READMEs.
6. Re-verify codeg line numbers if/when adopting any pattern from that project;
   codeg is in active development and likely to drift.