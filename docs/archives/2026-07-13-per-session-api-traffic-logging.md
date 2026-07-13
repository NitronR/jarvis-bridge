# Per-session API traffic logging

**Date:** 2026-07-13
**Session ID:** 3b5439d9-08db-4c76-a9ea-43f880dbe1f8

## Summary

Two pieces of work in this session:

1. Answered a question about whether the Claude ACP backend supports multiple concurrent
   sessions. Confirmed yes — it's not Claude-specific, it falls out of the generic
   `AcpAgentBackend` architecture (`capabilities.multipleSessions: true` is hardcoded for
   every backend on this class, sessions live in a `Map<sessionId, SessionContext>`, and
   `AcpConnection`'s JSON-RPC layer multiplexes in-flight requests by id rather than
   serializing to one at a time). No code changes, research-only.

2. Implemented per-session API (JSON-RPC) request/response logging for debugging, per the
   user's ask: one append-only file per session under a gitignored `.logs/` directory.

## Key decisions

- **Hooked in generically at the `AcpConnection` transport layer** (`src/agent/acp/jsonrpc.ts`),
  not at individual call sites in `AcpAgentBackend`. A single `onTraffic` callback fires for
  every request/response/notification crossing the wire in either direction. This guarantees
  every current and future JSON-RPC method gets logged automatically — no risk of a new call
  site forgetting to log.
- **sessionId correlation is best-effort**, extracted from `params.sessionId` (requests/
  notifications) or `result.sessionId` (responses to session-creating calls like
  `session/new`). Traffic that can't be attributed to a session (e.g. `initialize`) goes to
  a shared `.logs/_unscoped.log` rather than being dropped. Documented the two known rough
  edges (session/new's request is unattributable at send time; session/fork's response is
  attributed to the source session, not the new forked one) in `docs/acp-notes.md`.
- **Default on, opt-out via env** (`JARVIS_BRIDGE_API_LOGS=false`), directory configurable via
  `JARVIS_BRIDGE_API_LOGS_DIR` (default `.logs`) — mirrors the existing `JARVIS_BRIDGE_SHELL`
  opt-out pattern in `config.ts` rather than introducing a new on/off convention.
- Threaded the new `apiLogsDir` option through the registry's closure-based backend factory
  (`backendRegistry.ts`) directly from `createBackendRegistry`'s own scope, rather than routing
  it through `BackendPool`'s per-cwd `getOrCreate` options — it's a single fixed directory for
  the whole process lifetime, so there was no need to plumb it through the per-cwd override
  path (which, notably, doesn't even forward the existing `logsDir` today — a pre-existing gap,
  left alone).
- `.logs/*.log` files carry raw prompt/tool/file content — treated them like `.env` in
  `AGENTS.md`'s security-boundaries section (never commit, be careful sharing for debugging).

## Files modified

- `src/agent/acp/apiLog.ts` (new) — `ApiSessionLogWriter`, one `WriteStream` per sessionId.
- `src/agent/acp/jsonrpc.ts` — `onTraffic` hook wired into `sendRequest`/`sendNotification`/
  `handleLine`'s three incoming branches.
- `src/agent/acp/index.ts` — constructs the writer in `spawn()`, closes a session's stream on
  `deleteSession`, closes all on `shutdown`.
- `src/agent/index.ts`, `src/agent/backendRegistry.ts`, `src/index.ts` — threaded `apiLogsDir`
  from config down to `AcpAgentBackend.spawn()`.
- `src/config.ts` — new `apiLogging`/`apiLogsDir` fields, `JARVIS_BRIDGE_API_LOGS(_DIR)` env vars.
- `.gitignore`, `.env.example` — `.logs/` ignored and documented.
- `AGENTS.md` — mechanism note under Backend configuration, security note under
  Security/boundaries.
- `docs/acp-notes.md` — new section on the sessionId-correlation rough edges.
- Tests: `src/config.test.ts` (+2), `src/agent/acp/index.test.ts` (+2: end-to-end per-session
  file writes, and that `deleteSession` closes only that session's stream).

Verified: `npm run typecheck` clean, full `npm test` green (129/129 at the time), and — as a
live bonus — the user's already-running dev server picked up the change mid-session and started
writing real `.logs/` files, confirming the wiring works end-to-end without a restart being
required for ts-node's module resolution (it was, in fact, restarted by the user, not hot-reloaded).

## Note on concurrent changes

While this session was in progress, a large, unrelated volume of work landed in the same
working tree from elsewhere (a `SessionConfigStore` addition, `ChatsDrawer`/`WorkspacesDrawer`
components replacing `PastChatsMenu`, `backendPool.ts` changes, etc. — visible in `git status`
at session end). That work is **not** part of this session and isn't summarized here; it was
in flight concurrently and this session's diffs (`apiLog.ts`, `jsonrpc.ts`'s traffic hook, the
`apiLogsDir` threading) were spot-checked afterward to confirm they're still intact and
`tsc --noEmit` still passes against the merged state.

## Follow-up / next steps

- No rotation or size cap on `.logs/*.log` — not requested, not implemented. Worth revisiting
  if long-running sessions make these files unwieldy.
- Consider whether `session/fork`'s response deserves its own log file (see the `acp-notes.md`
  gotcha) if fork actually sees real usage.
