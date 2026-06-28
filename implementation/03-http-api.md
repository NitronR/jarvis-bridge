# 03 — HTTP API Reference

All endpoints are served by `src/server.ts` via Express. The server is **localhost-only** and
**unauthenticated** — it is a personal dev tool. JSON bodies are parsed with a generous limit on the
chat path (to carry base64 images, e.g. 40 MB) and tighter limits elsewhere. Validate request bodies
with Zod at this boundary.

`createServer(...)` is parameterized with the workspace path, port, the chat backend, the backend
pool, the initial-workspace path, the context-injection flags, an optional Slack token, an optional
model label, an auto-approve controller, and an onboarding flag.

Conventions:
- Success bodies are JSON unless noted. Errors are `{ error }` or `{ ok: false, error }` with an
  appropriate status.
- "session resolution" means: read `sessionId` from body or `?sessionId=`; if absent use the current
  session; otherwise look it up / load it through the pool.

---

## Health

### `GET /health`
Liveness of the gateway itself. → `{ ok: true }`.

### `GET /health/agent`
Reachability of the agent backend(s). Runs a one-shot healthcheck across active backends.
→ `{ agent: boolean }`.

> (With a single agent role, this returns a single `{ agent }` flag. The HUD top-strip status dot
> polls this endpoint.)

---

## Chat lifecycle

### `GET /chat/init`
Bootstrap or resume a session. Query: `sessionId?`, `cwd?`.

Resolves/creates a session (creating a fresh one when no resumable id is given), then returns:

```jsonc
{
  "ok": true,
  "backend": { "kind": "acp", "role": "chat", "model": "<label|null>" },
  "sessionId": "…",
  "cwd": "/abs/path",
  "resumed": false,
  "capabilities": { /* AgentCapabilities */ },
  "slashCommands": [ { "name": "…", "description": "…" } ],
  "history": [ /* ChatHistoryEntry[] */ ],
  "autoApprove": { "supported": true, "default": false, "override": null, "effective": false, "enabled": false },
  "model": { "supported": true, "available": [ { "modelId": "…", "name": "…" } ], "current": "…" }
}
```

Errors: `400` for bad `cwd` (missing / not a dir); `502` if the backend can't be reached.

### `POST /chat/send`  — **SSE**
Run one turn. Body:

```jsonc
{
  "message": "string",          // required (may be empty if images present)
  "images": [ { "data": "<base64>", "mimeType": "image/png", "filename": "x.png" } ], // optional, max ~10
  "onboarding": false,          // optional: prepend onboarding context
  "hideUserMessage": false,     // optional: don't record the user bubble in history
  "sessionId": "…"              // optional
}
```

Response is `text/event-stream`. Each event is a line:

```
data: {<ChatPatch>}\n\n
```

streamed in real time, terminated by:

```
data: {"type":"done"}\n\n
```

On error mid-stream, a `data: {"type":"error","message":"…"}` is emitted before the stream ends. The
turn aborts if the client closes the response, or after a long safety timeout (e.g. 20 minutes).
See the `ChatPatch` contract in [02-acp-backend.md](02-acp-backend.md).

### `POST /chat/cancel`
Cancel the in-flight turn for the resolved session. → `{ ok: true }` (no-op if idle).

### `POST /chat/steer`
Mid-turn steering. Body `{ prompt, sessionId? }`. If unsupported/idle →
`{ ok: true, accepted: false, reason: "unsupported" }`; otherwise
`{ ok: true, accepted, reason? }`.

### `POST /chat/approval`
Resolve a pending tool-approval surfaced via an `approval-request` patch. Body
`{ requestId, optionId, sessionId? }`. → `{ ok: true }`; `404` for unknown/already-resolved;
`409` if the session has no pending approvals.

---

## Models & auto-approve

### `GET /chat/model`  /  `POST /chat/model`
`GET` (requires `sessionId`) → `{ ok: true, supported, available[], current }`.
`POST` body `{ modelId, sessionId }` switches the model; `409` if the backend can't switch; `400` for
an unknown `modelId`.

### `GET /chat/auto-approve`  /  `POST /chat/auto-approve`
Snapshot/mutate the auto-approve flag.
- Without `sessionId`: targets the backend-wide **default**.
- With `sessionId`: targets the per-session **override**.

`POST` body `{ enabled: boolean | null, sessionId? }` — `boolean` sets, `null` clears an override
(not allowed for the default). Response carries `{ supported, default, override, effective, enabled }`.

---

## Sessions

### `GET /chat/sessions`
List resumable sessions (merged with locally-stored metadata). Query `sessionId?` marks the active
one. → `{ sessions: [ { sessionId, title?, displayTitle?, updatedAt?, cwd?, customTitle?, pinned?, group?, active, preview? } ] }`.

### `POST /chat/sessions/fork`
Clone a session. Body `{ sessionId, atMessageIndex? }`. Returns the new session:
`{ ok: true, sourceSessionId, sessionId, cwd }`. `501` if the backend can't fork.

> `atMessageIndex` is accepted for forward-compat but the underlying agent fork is a **full clone**;
> the gateway seeds the new session's UI history from the source (optionally truncated at the visible
> bubble index for display only).

### `PATCH /chat/sessions/:sessionId`
Update UI-side metadata. Body: at least one of `customTitle` (string|null), `pinned` (bool),
`group` (string|null). → `{ ok: true, sessionId, metadata }`. This metadata is persisted by the
gateway (e.g. `<workspace>/.jarvis-bridge/chat-session-metadata.json`), not by the agent.

---

## Workspace & folders

### `GET /workspace/status`
→ `{ onboarded, hasIdentity, hasUser }`. When onboarding is disabled, always reports
`{ onboarded: true, hasIdentity: true, hasUser: true }`.

### `GET /workspace/branch`
Query `folder?`. Current git branch of the folder (defaults to workspace).
→ `{ ok: true, branch, detached? }` or `{ ok: false, branch: null, error }` (graceful when not a repo).

### `POST /workspace/complete-onboarding`
Write the onboarding marker. → `{ ok: true }`.

### `POST /chat/pick-folder`
Native folder picker (macOS only). Body `{ initialCwd? }`. → `{ ok: true, cancelled, cwd }`;
`501` off-macOS.

### `POST /chat/worktree`
Create a git worktree from the repo containing `folder`, branched off the latest default branch, and
return its path so the UI can open a chat scoped to it. Body `{ folder, branch? }`. →
`{ ok: true, worktreePath, branch, baseRef }`; error bodies carry a `code`
(`not_a_repo` / `invalid_branch` / `git_missing` / …) mapped to a status.

---

## Status

### `GET /status/active`
Aggregated "is the agent busy?" snapshot, polled by the Status page. With cron removed it reports
only in-flight chat streams:

```jsonc
{
  "busy": true,
  "now": "2026-01-01T00:00:00.000Z",
  "chat": {
    "activeCount": 1,
    "streams": [
      { "streamId": "cs-1", "sessionId": "…", "startedAt": "…", "ageMs": 1234, "preview": "first 200 chars" }
    ]
  }
}
```

`busy` is true when any chat stream is active. (The original also carried a `cron` block — omitted.)

---

## Tools

### `POST /tools/execute`
Run a registered workspace tool. Body `{ tool, params }`. → `{ ok: true, result }` or `{ ok: true }`.
`404` unknown tool; `400` for path-outside-workspace / ENOENT. See
[07-tools-and-mcp.md](07-tools-and-mcp.md).

---

## Skills

### `GET /skills`
Discover skills in `<workspace>/skills/`. → `{ skills: [ { name, hasUi, displayName, description, icon } ] }`.

### `GET /skills/:name/ui/*`
Serve files from `<workspace>/skills/:name/ui/` (defaults to `index.html`; path-traversal guarded).

### `GET /skills/:name/data`  /  `PUT /skills/:name/data`
Read / atomically replace `<workspace>/.skills-data/:name/data.json`. `GET` returns `{}` if absent;
`PUT` body must be a JSON object.

### `GET /skills/initial`  /  `POST /skills/sync-to-initial`
List template skills / sync workspace skills back into the template dir (only those already present
in the template are synced). See [06-context-and-workspace.md](06-context-and-workspace.md).

---

## Slack (optional)

### `POST /slack/message`
Body `{ channel, text, thread_ts? }`. `503` if no token configured; `502` on upstream failure;
→ `{ ok: true, channel, ts }`. See [08-terminal-and-integrations.md](08-terminal-and-integrations.md).

---

## Event hooks (optional, no-op by default)

A generic, pluggable analytics seam — **no real analytics client**. Implement as no-ops or wire your
own sink.

### `GET /analytics/config`
→ `{ enabled: false, ... }` by default. The frontend reads this once on load; if `enabled` is false
it never posts events.

### `POST /analytics/track`
Accepts a single event or `{ events: [...] }`. Validate with Zod (a `screen` event or a
`ui`/`track`/`operational` action event). Fire-and-forget: respond `204` immediately. With no sink
configured this simply drops the events. See [08-terminal-and-integrations.md](08-terminal-and-integrations.md).

---

## Static files

`app.use(express.static("public"))` serves the SPA (HTML/CSS/JS) and favicons.

## Terminal (WebSocket, not HTTP)

`ws(s)://<host>/terminal?cwd=<path>` — handled by `src/terminal.ts` via the HTTP server's `upgrade`
event, not an Express route. See [08-terminal-and-integrations.md](08-terminal-and-integrations.md).
