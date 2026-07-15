# 2026-07-14 — Context window usage indicator

## Summary

Researched how ACP clients (Zed, OpenCode, claude-agent-acp) display context window
usage, discovered our backend already carries the data, and added a context usage
indicator below the Composer input in the frontend.

## Research findings

### Zed (`zed/crates/acp_thread`)
- Gets `size` (max context) and `used` (consumed tokens) from `SessionUpdate::UsageUpdate`
- Stores in `TokenUsage { max_tokens, used_tokens, input_tokens, output_tokens }`
- Warning threshold at 80% (`TOKEN_USAGE_WARNING_THRESHOLD = 0.8`)
- UI: progress ring in thread header, split input/output bars, tooltip with token counts + cost

### OpenCode (`packages/opencode/src/acp/usage.ts`)
- Sends `{ sessionUpdate: "usage_update", used, size, cost }` where:
  - `used = input_tokens + cache_read_tokens`
  - `size` from model metadata (`model.limit.context`)
  - `cost` as cumulative session cost
- Context limit fetched via `contextLimitLoader` (queries provider/model metadata)

### claude-agent-acp (`src/acp-agent.ts`)
- Sends `usage_update` with `{ used, size, cost }` on:
  - Each `result` (turn completion)
  - Mid-stream on `message_start`/`message_delta` (streaming usage)
  - On `rate_limit_event`
  - After compaction
- `size` from `session.contextWindowSize` (inferred from model name or from `result.modelUsage.contextWindow`)
- `used` from SDK's `getContextUsage()` or accumulated API usage counts

### Wire format (from actual API logs)
```json
{
  "sessionUpdate": "usage_update",
  "used": 32921,
  "size": 200000,
  "cost": { "amount": 0.42, "currency": "USD" }
}
```

## Our bridge already handled this

`src/agent/acp/mapping.ts` already normalizes `usage_update` into `UsageTotals` with
`context_limit` (from `size`) and `context_used` (from `used`). The data was flowing
end-to-end but the frontend only showed per-turn token count pills — `context_limit`
and `context_used` were never rendered.

## Changes made

### `frontend/src/components/ChatPanel.tsx`
- Added `useMemo` to extract latest `UsageTotals` from transcript (walks backwards
  through assistant entries finding the most recent `usage` patch)
- Passes `latestUsage` prop to `<Composer>`

### `frontend/src/components/Composer.tsx`
- Added `latestUsage?: UsageTotals` prop
- Renders context bar below textarea when `context_limit` is available:
  ```
  Context: 32,921 / 200,000 (16%)  ·  $0.42
  ```
- Percentage turns `--color-warning` (amber) when > 80%

### `frontend/src/components/Composer.module.css`
- Added `.contextBar` (11px, muted text, flex row)
- Added `.contextBar .warn` (warning color for high usage)

## Key decisions

- **Location**: Below Composer input (user's choice over header bar or InfoPanel)
- **Threshold**: 80% matches Zed's `TOKEN_USAGE_WARNING_THRESHOLD`
- **Data source**: Latest usage patch from transcript, not a separate state store
- **No new backend changes needed** — the data was already there

## Files modified
- `frontend/src/components/ChatPanel.tsx` — usage extraction + prop passing
- `frontend/src/components/Composer.tsx` — context bar rendering
- `frontend/src/components/Composer.module.css` — styling
- `docs/archives/2026-07-14-context-usage-indicator.md` — this file

## Follow-up

### Done (same day, continued session)
- **Verified end-to-end via API, not browser** — no browser-automation tool was available
  in this session, so instead: confirmed `frontend`/backend typecheck clean, ran the full
  backend test suite (139 tests), and cross-checked real `.logs/*.log` traffic captures
  from an earlier opencode session showing `usage_update` with real `size`/`used` values
  flowing through `mapping.ts` → `UsageTotals` correctly.
- **Found and fixed a real bug while verifying replay**: `captureReplayUpdate()` in
  `src/agent/acp/index.ts` had no case for `usage_update` — it fell into `default: break`
  and was silently dropped, even though `acpUpdateToPatches()` already computed a valid
  patch for it. This meant the context bar went blank after a page reload/session resume
  until a fresh `usage_update` arrived live. Fixed by appending the usage patch to the
  current assistant replay entry (only if one already exists, to avoid a bare usage update
  spawning an empty placeholder bubble). See `docs/acp-notes.md` for the full writeup.
- Added `X_FAKE_AGENT_REPLAY_UPDATES` to `test/fixtures/fake-streaming-agent.cjs` (session/load
  previously couldn't simulate in-flight replay notifications at all — no test exercised
  `loadSession`/`captureReplayUpdate` before this) and a regression test in
  `src/agent/acp/index.test.ts` verifying a replayed `usage_update` lands in the assistant
  entry's patches. Confirmed the test fails without the fix (reverted temporarily) and
  passes with it.
- **Found and fixed the actual root cause of "context bar not visible" (user-reported,
  reproduced on a real claude session)**: `usageFromAcp()` in `src/agent/acp/mapping.ts`
  returned `null` — discarding the whole update — whenever `inputTokens`/`outputTokens`/
  `cachedReadTokens`/`cachedWriteTokens` were all zero/absent. Read the actual
  `@agentclientprotocol/claude-agent-acp` source (`dist/acp-agent.js`, resolved via the npx
  cache since `apiLog.ts` isn't wired — see below) and confirmed its real `usage_update`
  notifications carry **only** `used`/`size`/`cost`, never a token breakdown. Every real
  claude `usage_update` was being silently dropped as a result. Fixed by also checking
  `limit`/`used`/`cost` in the null-check. Added a regression test
  (`mapping.test.ts`: "accepts a claude-shaped update with only used/size/cost, no token
  breakdown"), confirmed it fails without the fix. Verified live end-to-end against your
  real session `74308993-7d2d-43e9-8626-a159716e19cb` after you restarted the backend:
  a real turn now returns `context_limit`/`context_used`/`cost` correctly.
- **New known gap found while verifying**: reload/resume does not restore last-known usage
  — Claude's own `session/load` replay stream doesn't re-emit `usage_update` for past turns
  (unlike message/tool-call chunks), so the context bar still goes blank on page reload
  until the next live turn, even with the `captureReplayUpdate` fix above (which is correct
  but has nothing to catch here). See `docs/acp-notes.md` for a proposed fix (cache last
  known `UsageTotals` in `session_metadata.json`, return out-of-band in `GET /chat/init`).

### Done (session 3, same day — persist last-known usage across reload)
- Added `getLastUsage`/`setLastUsage` to `SessionConfigStore` (`src/agent/sessionConfigStore.ts`),
  persisted under a new `usage` key in `session_metadata.json` alongside auto-approve/metadata/cwds,
  with a `sanitizeUsage()` validator on load (mirrors `sanitizeMetadata`'s pattern).
- `POST /chat/send` (`src/server.ts`) now writes every `usage` patch it streams to
  `setLastUsage()`, fire-and-forget so it can't slow the SSE stream.
- `GET /chat/init` now returns `lastUsage` in its response body, independent of `history`/replay.
- Frontend: `ChatInitResponse`/`ChatState` carry `lastUsage`; `ChatPanel.tsx`'s `latestUsage`
  memo falls back to `ctx.state.lastUsage` only when the transcript has no usage patch yet
  (a live patch always wins once one arrives).
- Tests: `sessionConfigStore.test.ts` (get/set/reload/overwrite/malformed-entry), `server.test.ts`
  (send caches usage → later init resume returns it as `lastUsage`), `ChatPanel.test.tsx`
  (context bar renders from cached `lastUsage` with an empty transcript). All green; typecheck
  clean both sides.
- Note found along the way: `toLocaleString()` digit grouping is locale-dependent (the test
  environment's default locale renders `1000000` as `10,00,000`, Indian-style, not
  `1,000,000`) — not a bug, just worth knowing if the displayed context bar ever looks
  "wrong" depending on the browser's locale.

### Still open
- Manual browser click-through with a live opencode and claude session (needs a human or
  a browser-automation tool neither of which was available here) — worth doing now that both
  the data-flow bug and the reload-persistence gap are fixed. **Requires restarting the
  backend dev server** (plain `ts-node`, no watch mode) to pick up today's changes.
- Consider adding a thin progress bar for more visual impact
- Consider showing in InfoPanel sidebar when Composer is collapsed

### Separately noticed, not fixed (flagging for a decision)
- `src/agent/acp/apiLog.ts` (per-session API traffic logging) is dead code — `AGENTS.md`
  and `docs/acp-notes.md` both describe it as "hooked in generically at `AcpConnection`,"
  but `ApiSessionLogWriter`/`onTraffic` are never imported or referenced anywhere outside
  `apiLog.ts` itself; `AcpConnection` (`jsonrpc.ts`) has no traffic hook at all. The old
  `.logs/*.log` files on disk predate the currently-running dev server process (which
  itself started ~4 minutes before the commit that added `apiLog.ts`), so they're leftovers
  from some earlier, since-removed wiring — not evidence the current code works. This is
  doc drift plus a non-functional documented feature; left alone since wiring it up is a
  separate, non-trivial chunk of work outside this feature's scope. **Still open as of
  session end** — user hadn't decided whether to wire it up for real or correct the docs.

## Session info

- **Date/time**: 2026-07-14, ~14:09 IST (session spanned the full day across several
  continuations)
- **Session ID**: `e98af57e-e5cc-4fea-869f-22f82f028153`
- **Summary**: Built the context-window-usage indicator end to end, then chased a
  user-reported "not visible" bug through three layered root causes: (1) `usageFromAcp()`
  silently discarded every real claude `usage_update` because its null-check only looked at
  token-count fields, which claude's wire format never sends; (2) `captureReplayUpdate()`
  had no case for `usage_update`, so replay dropped it even when computed; (3) even after
  both fixes, Claude's own `session/load` doesn't replay `usage_update` at all, so a
  dedicated out-of-band cache (`sessionConfigStore.getLastUsage`/`setLastUsage`, surfaced via
  `GET /chat/init`) was added to survive page reloads. Root cause #1 was found by pulling the
  real `@agentclientprotocol/claude-agent-acp` package source from the npx cache and reading
  its actual emission code directly, since the per-session API traffic logging this repo's
  docs describe turned out to be entirely unwired (dead code, see below).
- **Key decisions**:
  - Fix data-flow bugs at the root (`mapping.ts`, `index.ts`, `sessionConfigStore.ts`) rather
    than only patching the frontend — the frontend rendering logic from the original
    implementation was correct throughout.
  - Cache last-known usage server-side rather than relying on/patching the agent's replay
    behavior, since that behavior is upstream and outside this repo's control.
  - Every fix shipped with a regression test proven to fail without the fix (reverted the
    source temporarily, confirmed red, restored, confirmed green) before being considered done.
  - Flag drift/gaps found along the way (apiLog.ts dead code, locale-dependent number
    formatting) rather than silently fixing or ignoring them.
- **Files modified**: `src/agent/acp/mapping.ts` + `.test.ts`, `src/agent/acp/index.ts` +
  `.test.ts`, `src/agent/sessionConfigStore.ts` + `.test.ts`, `src/server.ts` + `.test.ts`,
  `test/fixtures/fake-streaming-agent.cjs`, `frontend/src/api/types.ts`,
  `frontend/src/state/ChatContext.tsx` + `.test.tsx`, `frontend/src/state/useChat.test.tsx`,
  `frontend/src/components/ChatPanel.tsx` + `.test.tsx`,
  `frontend/src/components/InfoPanel.test.tsx`, `frontend/src/components/Composer.tsx` +
  `.module.css` (from the original implementation), `docs/acp-notes.md`, this file.
- **Follow-up / next steps**: see "Still open" above — manual browser click-through (backend
  restart required first), the `apiLog.ts` decision, and the cosmetic InfoPanel/progress-bar
  ideas remain open.
