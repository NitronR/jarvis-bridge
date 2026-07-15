# ACP backend notes

Implementation quirks of `src/agent/acp/index.ts` (`AcpAgentBackend`) that aren't obvious
from the ACP spec alone, discovered by testing against the real agent (opencode, via
`AGENT_CMD=opencode AGENT_ARGS=acp`). Read this before touching session lifecycle code.

## `session/load` replays history via notifications in flight, not in its response

Per the ACP spec, `session/load` does **not** return message history in its JSON-RPC
response body — the response only carries `configOptions` (model/mode selectors). The
agent instead streams the entire conversation back as `session/update` notifications
**while the `session/load` request is still pending**, using the same notification types
as live streaming (`user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`,
`tool_call`, `tool_call_update`). Confirmed against opencode's own agent-side
implementation (`packages/opencode/src/acp/service.ts`, `replayMessages`) and how Zed's
ACP client consumes it (`crates/agent_servers/src/acp.rs`).

**Consequence:** the session must be registered in `this.sessions` (with
`ctx.captureReplay = true`) *before* calling `sendRequest("session/load", ...)`, not
after awaiting it. `handleSessionUpdate()` drops any notification whose `sessionId` isn't
already in the map — so registering after the await silently discards the entire replay.
This bit us once already (fixed 2026-07-12; see `docs/archives/2026-07-12-session-history-restore.md`).

## `/chat/init` always resolves a session's own backend, and defaults cwd to the workspace

Two related, easy-to-regress details about `GET /chat/init` in `src/server.ts`:

- **cwd**: `createSession`/`loadSession` are always called with `cwd: requestedCwd ?? workspace`,
  never `undefined`. Passing `undefined` falls through to `AcpAgentBackend`'s own fallback,
  `process.cwd()` — the *server process's launch directory*, not the configured
  `JARVIS_BRIDGE_WORKSPACE`. Fixed 2026-07-13.
- **backend**: when resuming (`sessionId` present in the query), the backend used is resolved
  via `registry.findSession(sessionId)` — the backend that actually owns the session — not
  `registry.getDefaultBackend()`. If the default backend was changed at runtime (via
  `PUT /settings/default-backend`) after a session was created, reloading that session must
  still hit the backend it was created on, or the agent process behind it won't recognize the
  session id (`loadSession` throws). Fixed 2026-07-13. `findSession` / `listSessions` /
  `getSession` lazy-spawn every known profile's pool before consulting it, with `try`/`catch`
  per profile so a broken backend doesn't fail the whole lookup — so a session owned by a
  non-default backend is always reachable across server restarts, not just within the
  lifetime of whatever pools were eagerly spawned. Fixed 2026-07-14.
- **model**: when creating a fresh session (no `sessionId`), an optional `model` query param
  is applied via `backend.setSessionModel?.(session.id, q.model)` — this is what powers the
  "+ New" button's cmd/ctrl-click-to-open-in-a-new-tab handoff (`openNewChatInNewTab` in
  `useChat.ts`), which passes the current tab's `cwd`/`backend`/`model` as one-shot URL params.
  This call must stay wrapped in `try`/`catch` (ignore on failure), mirroring the same
  best-effort pin already done inside `AcpAgentBackend.createSession` (`src/agent/acp/index.ts`)
  and the `try`/`catch` in `POST /chat/model`. Not every backend supports `session/set_model`
  — the Claude ACP backend rejects it with `AcpRequestError: "Method not found":
  session/set_model` — and until 2026-07-15 this one call site had no `try`/`catch`, so that
  rejection propagated uncaught, 500'd the whole `/chat/init` request, and the frontend's error
  path (correctly) tore down the session and stripped the URL params. From the user's
  perspective this looked like "cmd-click new chat doesn't work" (bare URL, no model shown,
  fork disabled) with no server-side hint beyond an HTML 500 page — the two other
  `setSessionModel` call sites already handled this defensively, only this one didn't. Fixed
  2026-07-15.

## Replay capture must populate patches, not just create placeholder entries

`captureReplayUpdate()` reconstructs `ChatHistoryEntry[]` from the replayed notifications.
For assistant turns it's not enough to push a placeholder `{ kind: "assistant", patches: [] }`
— the actual `ChatPatch[]` computed by `acpUpdateToPatches()` for each notification must be
appended into that entry's `patches` array. During a live turn those patches are also
forwarded to `ctx.onPatch`, but `onPatch` is `null` during replay (it's only wired up inside
`sendMessage`'s streaming generator), so relying on it to populate history is a no-op.

The `switch (update.sessionUpdate)` in `captureReplayUpdate()` only had cases for
`user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call` /
`tool_call_update` — anything else (`usage_update`, `available_commands_update`, ...) hit
`default: break` and was silently dropped, even though `acpUpdateToPatches()` had already
computed a real patch for it. Concretely this meant the context-usage indicator (see below)
went blank after a page reload/session resume until a fresh `usage_update` arrived, since the
replayed history never carried one. Fixed 2026-07-14 by adding a `usage_update` case that
appends to the current assistant entry — but only if one already exists, to avoid spawning an
empty placeholder bubble from a bare usage update with no preceding message/tool chunk.

## Per-session API traffic logging: sessionId correlation is best-effort, not exact

`src/agent/acp/apiLog.ts` + the `onTraffic` hook in `AcpConnection` (`jsonrpc.ts`) write one
JSONL entry per JSON-RPC request/response/notification into `.logs/<sessionId>.log`,
correlated by pulling `sessionId` out of `params`/`result` wherever it's present. Two
non-obvious consequences of that approach:

- **`session/new`'s request is unattributable at send time** — its params are only
  `{ cwd, mcpServers }`, no `sessionId` yet. That request entry lands in `.logs/_unscoped.log`,
  not the new session's file; only the *response* (which carries the freshly minted
  `sessionId`) makes it into `<sessionId>.log`. Same applies to any future session-creating
  method whose request doesn't echo an ID.
- **`session/fork`'s response is attributed to the *source* session, not the new forked one**
  — `sendRequest`'s logger uses the sessionId captured at request time if present, and
  `session/fork`'s request params carry the source session's `sessionId`, so it wins over the
  `sessionId` in the response result. If fork ever needs its own log file, the extraction logic
  in `AcpConnection.sendRequest` (`jsonrpc.ts`) needs a fork-specific carve-out, not just
  `sessionId ?? extractSessionId(result)`.

## `usage_update` carries context window size and used tokens

Both opencode and claude-agent-acp send `usage_update` notifications via
`session/update` with this wire format:

```json
{
  "sessionUpdate": "usage_update",
  "used": 32921,
  "size": 200000,
  "cost": { "amount": 0.42, "currency": "USD" }
}
```

- **`size`**: max context window for the current model (opencode gets it from model
  metadata, claude infers it from the model name or `result.modelUsage.contextWindow`)
- **`used`**: tokens consumed so far (opencode: `input_tokens + cache_read_tokens`,
  claude: from SDK's `getContextUsage()` or accumulated API usage)
- **`cost`**: optional, cumulative session cost in USD

`src/agent/acp/mapping.ts` normalizes this into `UsageTotals` with `context_limit`
(from `size`) and `context_used` (from `used`). The frontend Composer component now
displays this as a small status line below the input area. The 80% warning threshold
matches Zed's `TOKEN_USAGE_WARNING_THRESHOLD`.

**`usageFromAcp()`'s "is this update usable" check must include `size`/`used`/`cost`, not
just token counts.** The real `@agentclientprotocol/claude-agent-acp` package (confirmed by
reading `dist/acp-agent.js` directly, since our own `.logs/*.log` capture wasn't actually
wired — see below) sends `usage_update` with **only** `used`/`size`/`cost` — it never
includes `inputTokens`/`outputTokens`/`cachedReadTokens`/`cachedWriteTokens`. The original
null-check (`if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return
null`) only looked at those four token fields, so every real claude `usage_update` was
silently discarded and the context bar never had data for claude sessions. Fixed
2026-07-14 by also checking `limit`/`used`/`cost` before returning null. Confirmed live
against a running claude session post-fix: `context_limit`/`context_used`/`cost` all flow
through correctly on each turn now.

**Reload/resume does not restore the last known usage via replay — it's cached out-of-band
instead.** Unlike message and tool-call chunks, Claude's `session/load` replay stream does
not re-emit `usage_update` notifications for past turns — confirmed by observing a live
session's replayed history after a real turn that indisputably produced a `usage_update`
(verified via a direct `session/prompt` round-trip) still came back with no `usage` patch
on the following `session/load`. The `captureReplayUpdate()` fix for `usage_update` (see
above) is real and correct — proven by a fake-agent unit test — but has nothing to catch
here because the upstream agent doesn't include usage in what it replays.

Fixed 2026-07-14 by caching the last known `UsageTotals` per session independent of replay:
`POST /chat/send` (`src/server.ts`) writes every `usage` patch it streams to
`sessionConfigStore.setLastUsage()` (fire-and-forget — must not slow the SSE stream; a lost
write just means a stale/missing bar, not a broken one), and `GET /chat/init` returns it as
`lastUsage` in the response body, independent of `history`. The frontend
(`ChatPanel.tsx`'s `latestUsage` memo) uses it as a fallback only when the transcript itself
has no usage patch yet (i.e. right after a resume, before any live turn in that tab) — once
a live `usage` patch arrives it takes over, same as before.

Both backends send `usage_update` at multiple points:
- On each `result` (turn completion)
- Mid-stream during `message_start`/`message_delta` (claude only)
- On `rate_limit_event` (claude only)
- After context compaction (claude only)

## `rate_limit_event` carries subscription quota via `usage_update._meta`

The `usage_update` fired by claude-agent-acp on a `rate_limit_event` carries no token
counts at all — just a `_meta` sibling of `sessionUpdate`/`used`/`size`:

```json
{
  "sessionUpdate": "usage_update",
  "_meta": {
    "_claude/rateLimit": {
      "status": "allowed_warning",
      "rateLimitType": "seven_day",
      "utilization": 0.86,
      "resetsAt": 1752549740000
    }
  }
}
```

- **`rateLimitType`**: which quota window this event describes — `five_hour`, `seven_day`,
  plus model-scoped/overage variants (`seven_day_opus`, `seven_day_sonnet`,
  `seven_day_overage_included`, `overage`). Each event reports exactly one window, not all
  of them at once.
- **`status`**: `allowed` / `allowed_warning` / `rejected`
- **`utilization`**: 0–1 fraction of the window consumed
- **`resetsAt`**: epoch ms

`usageFromAcp()` (`src/agent/acp/mapping.ts`) extracts this into `UsageTotals.rate_limits`,
keyed by `rateLimitType`. Because each event only ever reports one window, `mergeUsage()`
merges `rate_limits` by key instead of replacing the whole map — an incoming `five_hour`
update must not blank out the last known `seven_day` value. For the same reason,
`resetTurnState()` (which otherwise zeroes `state.usage` at the start of every turn)
explicitly carries `rate_limits` forward: these events are infrequent, so a turn boundary
with no fresh rate-limit event shouldn't blank the panel. `sessionConfigStore`'s
`sanitizeUsage()` persists `rate_limits` the same way it persists `context_limit`/`cost`, so
the InfoPanel's "Usage" card survives a gateway restart via `lastUsage`, same fallback path
described above. Surfaced in the frontend as a card in `InfoPanel.tsx`, below "Session".

## Frontend: one-shot request patches (`approval-request`, `elicitation-request`, ...) must be deduped by identity in `Timeline.tsx`

`Timeline`'s `buildTimelineState()` re-walks the *entire* patches array from scratch on
every recompute — it's a `useMemo` keyed on `patches`, and `patches` grows by one entry per
streamed delta. For rendering (text/tool bubbles) that's fine, since building the bubble
list from scratch is idempotent. But `approval-request`/`elicitation-request`/`steer-ack`/
`images-skipped` also fire an `emit.onXxx?.(p)` side-effect callback as they're walked —
and without a guard, that callback re-fires **every time the array is recomputed**, not
just the first time that patch is seen. Concretely: a user answers an `elicitation-request`
(closing the modal), then the turn continues (tool result, more assistant text) — each of
those later patches triggers another full walk of the array, and the *already-answered*
`elicitation-request` patch fires `onElicitation` again, reopening the same modal. Same
failure mode applies to re-approving an already-resolved `approval-request` or re-toasting
an already-shown `steer-ack`/`images-skipped`.

Fixed by giving `Timeline` a ref-held `Set<ChatPatch>` (`emittedRef`, keyed by patch object
identity — stable across recomputes since historical patches are never mutated or
recreated, only appended to) and checking `emitted.has(p)` before invoking each callback.
See `src/agent/acp/index.ts`'s `PendingElicitation`/`PendingApproval` maps for the backend
half of the same request/response pattern. **Any new one-shot `ChatPatch` variant that
carries a callback through `buildTimelineState` needs the same `emitted.has(p)` guard** —
it's easy to add a new case to the `switch` in `buildTimelineState` and forget this, since
the bug only shows up once patches keep streaming in after the one-shot patch, not in a
quick manual test. Regression tests: `Timeline.test.tsx` → "does not re-emit
elicitation-request/approval-request when later patches stream in after resolution".

## Verifying replay end-to-end

The fastest way to check this mechanism still works after touching `loadSession`,
`handleSessionUpdate`, or `captureReplayUpdate` is a direct API round-trip (no browser
needed):

```bash
# 1. create a session
curl -s 'http://localhost:3001/chat/init' | python3 -m json.tool
# note the sessionId

# 2. send a message
curl -s -N -X POST 'http://localhost:3001/chat/send' \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<SID>","message":"Say the single word: kiwi"}'

# 3. simulate a reload
curl -s "http://localhost:3001/chat/init?sessionId=<SID>" | python3 -m json.tool
# `history` should contain the user message and the assistant's patches (not [])
```
