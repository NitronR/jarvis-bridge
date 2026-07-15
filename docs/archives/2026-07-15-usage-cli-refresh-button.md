# Session archive: manual usage-refresh button (shells out to `claude --print "/usage"`)

**Date:** 2026-07-15
**Session ID:** c3afdb7d-99af-4e15-9155-e710d18fff0c

## Summary

Follow-on to the same day's `2026-07-15-usage-panel-info-sidebar.md` work. After that session's InfoPanel
"Usage" card shipped, the user asked to run `claude --help` to check for a CLI usage flag. There wasn't
one at the top level, but testing `claude --print --output-format json "/usage"` showed it works
non-interactively and returns the exact same session/week percentages the interactive `/usage` command
shows — reliably, unlike the passive `rate_limit_event` (which, per the prior archive note, often omits
`utilization` entirely). The user proposed adding a button in the Usage panel that calls an API which
runs this CLI command on demand. Implemented end-to-end: backend capability + route + CLI shellout,
frontend refresh button + per-field merge with the existing passive-event data.

## Key decisions

- **Shell out to the standalone `claude` CLI directly, bypassing the ACP adapter entirely for this one
  call.** The long-lived ACP subprocess (`claude-agent-acp`) doesn't expose the SDK's richer `get_usage`
  control API (confirmed in the prior archive note), so this is a second, independent, short-lived
  process spawned per request via `execFile` with an argument array (no shell, no injection surface —
  args are fixed, nothing from the request reaches the spawned command).
- **New capability (`usageQuery`) decided from the static `kind === "claude-acp"` config, not the ACP
  handshake** — unlike every other capability on `AcpAgentBackend`, there's no protocol-level signal to
  negotiate this off of; it's a fact about a side-channel CLI invocation, not this connection's
  capabilities. Judged consistent with existing conventions (the class already privately holds `kind`
  and other backend-specific decisions live inside `AcpAgentBackend` itself) rather than a violation of
  the "capability-driven, not hardcoded kind branches" rule, which targets shared cross-backend code
  (`server.ts`, `mapping.ts`), not a backend's own self-description.
- **The CLI's text output has no discrete status field** (unlike the structured `rate_limit_event`) — a
  `status` is derived from the percentage using the same 80%/100% thresholds already used for the
  warning color, documented as a heuristic, not authoritative.
- **`resetsAt` from CLI text can't be reliably converted to an exact epoch timestamp** (no year, named
  timezone region like "Asia/Calcutta") — added `RateLimitWindow.resetsAtText` as a verbatim fallback;
  the frontend prefers the numeric `resetsAt` (from the passive event) when both are present.
- **Per-field merge, not wholesale replace, when combining passive-event and manual-refresh data** — the
  two sources contribute different fields (CLI: `utilization`/`resetsAtText`; passive event:
  `status`/`resetsAt`), so `ChatPanel.tsx`'s `mergeRateLimits` merges within each window rather than
  letting one channel's update blank out the other's fields.
- **Not persisted across reload** — manual refresh results live only in local React state, cleared on
  session switch. Kept out of scope; the existing passive-event `lastUsage` persistence is untouched.
- Flagged to the user (per AGENTS.md's "ask first before adding a new external integration surface") that
  this adds a new kind of surface — the gateway spawning a second CLI process on a button click — after
  the fact rather than before, since it emerged organically from the conversation; user accepted it as
  built (low risk: read-only, fixed args, no shell).

## Files modified

- `src/agent/acp/claudeUsage.ts` (new) — `parseClaudeUsageText`, `queryClaudeUsageViaCli` (injectable
  `execFile` for tests).
- `src/agent/acp/claudeUsage.test.ts` (new) — 9 tests, including the real `/usage` text captured earlier
  in the session.
- `src/agent/acp/index.ts` — `AcpAgentBackend.queryUsage()`, `capabilities.usageQuery`.
- `src/agent/acp/index.test.ts` — +3 tests, end-to-end via a fake `claude` CLI fixture (real `execFile`
  path, not mocked).
- `src/agent/types.ts` — `AgentCapabilities.usageQuery`, `AgentBackend.queryUsage?`,
  `RateLimitWindow.resetsAtText`.
- `src/server.ts` — `GET /chat/usage?sessionId=...` (404/501/502 handling), `UsageQuerySchema`.
- `src/server.test.ts` — +4 tests (supported/unsupported/error/unknown-session).
- `test/fixtures/fakeBackend.ts` — `queryUsage` injection point, `usageQuery` capability default.
- `test/fixtures/fake-claude-usage-cli.cjs` (new) — fake `claude` CLI for the index.test.ts end-to-end
  case.
- `frontend/src/api/types.ts` — `AgentCapabilities.usageQuery`, `RateLimitWindow.resetsAtText`.
- `frontend/src/components/InfoPanel.tsx` — refresh button (spinning icon while loading, disabled during
  refresh), placeholder row when supported-but-no-data-yet, `formatResetsAt` prefers numeric over text.
- `frontend/src/components/InfoPanel.module.css` — `.cardHeader`, `.refreshButton`, `.spinning` keyframe.
- `frontend/src/components/InfoPanel.test.tsx` — +4 tests.
- `frontend/src/components/ChatPanel.tsx` — `onRefreshUsage`, `manualRateLimits`/`refreshingUsage` state,
  `mergeRateLimits`, `displayedUsage` memo, session-switch reset effect.
- `frontend/src/components/ChatPanel.test.tsx` — +1 test (full click → fetch → render flow).
- `frontend/src/state/ChatContext.test.tsx`, `frontend/src/state/useChat.test.tsx` — added `usageQuery:
  false` to capability literals for the new required field (mechanical, no behavior change).
- `docs/agent-claude-code.md` §6/§11 — documented the shellout approach, superseding the prior "left as a
  known gap" framing with what was actually shipped.

## Verification

- Backend: `npm run typecheck` clean; `npm test` — **178/178 pass**.
- Frontend: `npx tsc --noEmit` clean; full `vitest run` — **157/157 pass** (3 pre-existing unhandled-
  rejection warnings in `ChatContext.test.tsx` confirmed via `git stash` to predate this session — not a
  regression).
- Not manually verified against a real authenticated Claude account by the agent in this session (no
  browser access) — user confirmed "worked, thanks" after testing themselves.

## Follow-up / next steps

- None required — user confirmed the feature works. If ever revisited: persisting manual-refresh results
  across reload, or surfacing per-model weekly breakdown lines (e.g. "Current week (Fable): 0% used",
  deliberately not parsed — no clean `rateLimitType` slot for it) are the two natural next increments,
  not currently planned.
