# claude-agent-acp — Exploration Notes

**Source:** `~/Desktop/opensource/claude-agent-acp` (agentclientprotocol/claude-agent-acp)
**Local checkout:** v0.58.1, ESM, Node 22+
**What it is:** Official ACP **adapter** that wraps the Claude Agent SDK. Published as
`@agentclientprotocol/claude-agent-acp`.

---

## Summary

- **Two uses:** npm library import OR stdio ACP executable (`claude-agent-acp` bin).
- **Compact source:** ~6,500-line core in `src/acp-agent.ts`. Helpers in `tools.ts`,
  `elicitation.ts`, `settings.ts`, `utils.ts`, `lib.ts`.
- **Registered ACP methods:** `initialize`, `session/new`, `session/load`,
  `session/fork`, `session/list`, `session/delete`, `session/resume`, `session/close`,
  `session/set_mode`, `session/set_config_option`, `authenticate`, `logout`,
  `session/prompt`, plus `session/cancel` notification.
- **Advertised capabilities:** image prompts, embedded context, HTTP MCP, SSE MCP,
  logout, session load/close/delete/fork/list/resume, prompt queueing.
- **Optional `--cli` mode** delegates to Claude's native CLI for auth flows.

## Worth borrowing

| # | Pattern | Reference | Why for jarvis_bridge |
|---|---------|-----------|----------------------|
| A | **Persistent consumer, short-lived prompt deferreds** | `src/acp-agent.ts:196-238, 1268-1305, 1291-1311` | One long-lived SDK stream consumer drains all messages for a session. Each prompt is a deferred `Turn`. Don't bind backend consumption to a single HTTP request lifetime. |
| B | **Single outbound update chokepoint** | `src/acp-agent.ts:1394-1412` | All session updates pass through `sendUpdate()`. Centralises event sequencing, persistence, fan-out, telemetry, redaction. |
| C | **Capability negotiation drives wire behavior** | `src/acp-agent.ts:956-1104, 4956-4993` | Doesn't blindly emit newer structures. Checks client capabilities for terminal output, terminal auth, elicitation forms, boolean config options, gateway auth. |
| D | **Backend-specific fidelity namespaced under `_meta`** | `src/acp-agent.ts:424-502` | Keeps main ACP fields portable; namespacing like `_meta.claudeCode.toolName`, `_meta.terminal_info`. Multi-backend gateway pattern. |
| E | **Idempotency sets for racing tool sources** | `src/acp-agent.ts:3464-3544, 360-368` | `emittedToolCalls` lets tool calls discovered via permission callbacks and stream events converge. Treat each tool-call ID as an idempotency key. |
| F | **Reuse mapping for live and replay paths** | `src/acp-agent.ts:3402-3452` | `replaySessionHistory()` passes persisted messages through `toAcpNotifications()` with hooks disabled. Minimises live/replay drift. |
| G | **Session-defining fingerprint** | `src/acp-agent.ts:406-416, 4167-4182` | Resume with different cwd/MCP config → recreate. Classify config as live-mutable vs. next-turn vs. session-defining. |
| H | **Cancellation is a state machine, not a boolean** | `src/acp-agent.ts:168-177, 1622-1710, 2983-3163` | Maintains orphan command map, owed-idle counter. Accounts for backend messages that may still execute after local cancellation. |
| I | **Result vs. idle are distinct terminal signals** | `src/acp-agent.ts:1949-2024, 2513-2522` | Distinguish: answer complete, backend idle, process closed, request cancelled. Use idle as cancellation completion + missing-result detector. |
| J | **Stream deduplication by content prefix** | `src/acp-agent.ts:2803-2864` | Compares consolidated text with streamed text, forwards only the unstreamed suffix. Robust when proxies mutate/omit message IDs. |
| K | **Incremental JSON refinement is linear** | `src/acp-agent.ts:513-575, 6236-6278` | Scanner stores prior offset and lexical state; each fragment scanned once. Avoids re-parsing complete partial string on every delta. Important for large tool args. |
| L | **Resource ownership documented** | `src/acp-agent.ts:3165-3227` | `closeQueryStream()` doesn't abort a possibly client-owned AbortController; explicit session teardown does. |
| M | **Output-channel discipline** | `src/index.ts:53-58` | Redirects console methods away from stdout to prevent logs corrupting ACP NDJSON. For WS: never put diagnostics on protocol channel without framing. |
| N | **Missing-result detection from idle** | `src/acp-agent.ts:1949-2024` | If active turn reaches unowed idle without result, fails immediately rather than hanging. |
| O | **Permission Promise+AbortSignal forwarding** | `src/acp-agent.ts:3464-3497, 6317-6347` | JSON-RPC request cancellation ↔ agent session cancellation ↔ backend query interruption ↔ permission subrequest cancellation. All forwarded correctly. |
| P | **Synthesize structured ACP errors from CLI text** | `src/acp-agent.ts:736-767, 2798-2800, 3417-3422` | "Please run /login" → `authRequired`. Avoids client-side message parsing. |

## Worth knowing about

- **Terminal support is output-only**, not a PTY. If client advertises `_meta.terminal_output`,
  Bash is presented as a terminal-backed tool call. No interactive terminal input API
  in this repo.
- **Settings watching** uses `notify` (or equivalent) with directory-based watching +
  100ms debounce (`src/settings.ts:115-165`). Detects creation as well as modification.
- **Permission mode eligibility** depends on model: `auto` only if
  `ModelInfo.supportsAutoMode`. `bypassPermissions` rejected when running as root unless
  sandboxed (`src/acp-agent.ts:647-649, 4834-4885`).
- **`ExitPlanMode`** is a special permission case with options for plan-mode exit
  strategy (`src/acp-agent.ts:3593-3678`).
- **Refusal handling** streams an explanation before returning ACP's `refusal` stop
  reason (`src/acp-agent.ts:2396-2414`).

## Native binary resolution

- Honors `CLAUDE_CODE_EXECUTABLE` env var.
- Resolves optional platform packages relative to the SDK package.
- Distinguishes Linux glibc vs. musl.
- Produces remediation error if binary is missing (`src/acp-agent.ts:590-628`).

## Environment variables

- `CLAUDE_CONFIG_DIR` — settings location override
- `CLAUDE_CODE_EXECUTABLE` — native binary path
- `IS_SANDBOX` — affects bypass permissions eligibility
- `SSH_CONNECTION`/`SSH_CLIENT`/`SSH_TTY`/`CLAUDE_CODE_REMOTE` — remote detection
- `MAX_THINKING_TOKENS` — 0 = disabled, positive = fixed budget
- `CLAUDE_MODEL_CONFIG` — `modelOverrides` + `availableModels` (disabled if caller passes
  `_meta.claudeCode.options.settings`)
- `ANTHROPIC_BASE_URL` / `ANTHROPIC_CUSTOM_HEADERS` — gateway auth

## Specific file references (deep dive starting points)

- `src/acp-agent.ts` (~6,500 lines) — core implementation
- `src/tools.ts` — tool metadata/results → ACP tool-call content, diffs, terminals, plans
- `src/elicitation.ts` — MCP elicitation, AskUserQuestion, refusal fallback
- `src/settings.ts` — Claude settings resolution + live file watching
- `src/utils.ts` — `Pushable<SDKUserMessage>` async push queue + Node/Web stream adapters
- `src/lib.ts` — public exports: `ClaudeAcpAgent`, `runAcp`, `toAcpNotifications`,
  `streamEventToAcpNotifications`, `SettingsManager`
- `src/index.ts` — CLI startup, native CLI delegation, stdio discipline, process shutdown

## Gateway-oriented architectural takeaway

For a general HTTP/WebSocket gateway, keep these layers separate as this package does:

1. **Transport layer** — stdio NDJSON here; WebSocket/HTTP in a gateway.
2. **Protocol dispatcher** — ACP method registration.
3. **Backend adapter** — `ClaudeAcpAgent`.
4. **Session-owned stream state** — one persistent SDK stream consumer per session.
5. **Mapping utilities** — Claude message/tool formats to ACP updates.
6. **Client callback abstraction** — `AcpClient` encapsulates calls from agent back to client.