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
  session id (`loadSession` throws). Fixed 2026-07-13. Caveat: `findSession()` only searches
  backend pools already spawned in the current server process's lifetime — a session whose
  backend was never touched since the last server restart still falls back to the current
  default.

## Replay capture must populate patches, not just create placeholder entries

`captureReplayUpdate()` reconstructs `ChatHistoryEntry[]` from the replayed notifications.
For assistant turns it's not enough to push a placeholder `{ kind: "assistant", patches: [] }`
— the actual `ChatPatch[]` computed by `acpUpdateToPatches()` for each notification must be
appended into that entry's `patches` array. During a live turn those patches are also
forwarded to `ctx.onPatch`, but `onPatch` is `null` during replay (it's only wired up inside
`sendMessage`'s streaming generator), so relying on it to populate history is a no-op.

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
