# Reconnecting to a streaming agent response after disconnect

Status: approved
Date: 2026-07-15

## Problem

When a browser tab disconnects mid-turn (page refresh, network blip, tab close) and
reconnects, jarvis_bridge today does not resume the in-flight response. Two independent
bugs compound to cause this:

1. **Disconnect is treated as cancel.** `POST /chat/send` (`src/server.ts:174-228`) wires
   the request's abort signal directly to `session.cancel()`:

   ```ts
   const signal = new AbortController();
   req.on("close", () => signal.abort());
   ```

   `sendMessage`'s `onAbort` handler (`src/agent/acp/index.ts:809-811`) calls
   `this.cancel()`, which sends a real `session/cancel` notification to the agent
   (`index.ts:872-881`). A page refresh — not just a lost view — kills the actual agent
   turn.

2. **Reconnect silently orphans the session's live state, even without the abort bug.**
   `GET /chat/init` always calls `backend.loadSession()` when a `sessionId` is present
   (`server.ts:80-87`), by design — this is what triggers the agent to replay history via
   `session/update` notifications for the ordinary "resume a finished conversation" case.
   But `loadSession()` (`acp/index.ts:416-445`) unconditionally replaces the session's
   entire `SessionContext`:

   ```ts
   const ctx = this.makeSessionContext();
   ...
   this.sessions.set(sessionId, ctx);      // overwrites the live ctx
   const sessionObj = new AcpAgentSession(this, sessionId, ctx);
   this.sessionObjects.set(sessionId, sessionObj);  // overwrites the live session object
   ```

   `handleSessionUpdate()` (`index.ts:245-257`) looks up `ctx` fresh from `this.sessions`
   on every notification. Once `loadSession()` overwrites the map entry, all subsequent
   `session/update` notifications route to the *new* ctx — the original, still-running
   `sendMessage()` generator (which closed over the *old* ctx via `this.ctx.onPatch = ...`
   at `index.ts:802`) never receives another patch. The turn stalls permanently, and the
   new resident session object reports `busy: false` even though the agent is still
   actively generating.

   Net effect: reconnecting mid-turn today doesn't just fail to resume the stream — it
   permanently breaks the turn's internal plumbing, independent of bug #1.

Any fix must address both, not just add a reattach endpoint on top of the existing
abort-on-disconnect and replace-ctx-on-init behavior.

## Research: how other ACP-adjacent projects handle this

(Full findings recorded during brainstorming; summarized here for context.)

- **ACP protocol itself has no mid-turn resume primitive.** `session/load` replays
  *completed* history via notifications (what jarvis_bridge already uses). `session/resume`
  is, per Zed's own doc comment, a fast reattach for a client that *already has the
  transcript* — "without replaying previous messages" — not a catch-up mechanism. Neither
  defines a turn ID, streaming cursor, or "resume from event N" concept.
- **opencode** decouples turn execution from any single viewer entirely: a core
  session/event-bus engine persists message parts incrementally as they stream, and the
  ACP-facing layer is a disposable subscriber. Killing the subscriber doesn't touch the
  running turn; a reconnecting client re-fetches current (possibly partial) state and then
  resumes live.
- **codeg** (custom Rust/Tauri backend, not ACP) keeps an in-process `SessionState` per
  session with live turn state plus a seq-numbered ring buffer on a broadcast channel.
  Reconnect sends `attach { since_seq }`; the server replies with a snapshot or a replay of
  buffered events, then subscribes the client to the live channel under one lock (no gap).
- **acp-ui** is the cautionary tale: no in-flight buffer, transport-close rejects pending
  RPCs, and it deliberately disables auto-reconnect to avoid desync — pure "reload history
  after the fact," which is the failure mode we're trying to avoid.

jarvis_bridge's gateway process is already long-lived and holds a persistent ACP
connection to the agent subprocess, independent of any browser tab's HTTP connection — so
we don't need opencode's full global-bus rearchitecture. We mainly need to (a) stop
conflating "browser disconnected" with "cancel the turn," (b) stop discarding live session
state on reconnect, and (c) add a small per-session buffer so a reconnecting tab can catch
up and then keep receiving live patches.

## Decisions from brainstorming

- **Disconnect never auto-cancels a turn.** Only the explicit `/chat/cancel` (Stop button)
  cancels. This applies uniformly to refresh, network blips, and tab close — no attempt to
  distinguish them via `beforeunload`/`visibilitychange`, since those signals are
  unreliable (notably on mobile) and acp-ui's own experience confirms building reconnect
  logic on top of them is a trap.
- **Idle-turn grace period as a resource-hygiene backstop.** A turn with zero attached
  viewers keeps running, but if nothing reattaches within a grace period, it is cancelled
  for real. This is not part of the reconnect UX — it exists only so a genuinely abandoned
  tab doesn't leave an agent subprocess burning tokens indefinitely. Default: **5 minutes**,
  overridable via `JARVIS_BRIDGE_IDLE_TURN_GRACE_MS`.
- **Single viewer, latest wins.** Only one live connection is considered "attached" to a
  session's active turn at a time. A new attach (e.g. a refreshed tab) replaces the
  previous one. No broadcast/fan-out to multiple simultaneous tabs on the same session.

## Design

### 1. Stop conflating disconnect with cancel

Remove the `req.on("close") → signal.abort()` wiring in `POST /chat/send`
(`server.ts:193-194`). The handler's `for await` loop over `session.sendMessage(...)`
keeps running after the client disconnects; it simply stops writing to the now-dead `res`
(guarded by checking `res.writableEnded`/`res.destroyed` before each `res.write`).

### 2. Track live-turn state on the session, not the request

Add to `SessionContext` (`acp/index.ts:57-80`):

```ts
activeTurn: {
  patches: ChatPatch[];
  viewerRes: Response | null;
  idleTimer: NodeJS.Timeout | null;
} | null;
```

Set when a turn starts (alongside `ctx.busy = true` in `sendMessage`), cleared when it
finishes (`done`/`error` patch). Every patch yielded by `sendMessage` is appended to
`activeTurn.patches` and, if `activeTurn.viewerRes` is set, written to it directly — this
is the mechanism that lets a second HTTP request "become" the live writer for a turn
started by a different, now-disconnected request.

### 3. `/chat/init` must not replace a live session's ctx

In `server.ts`'s `/chat/init` handler, before calling `backend.loadSession()`, check
whether the backend already has a resident session for this ID with an active turn (new
method, e.g. `backend.getActiveTurn(sessionId): { patches: ChatPatch[] } | null`, exposed
through `AgentSession`/`AcpAgentBackend` so `server.ts` doesn't reach into ACP internals
directly). If an active turn exists:

- Skip `loadSession()` entirely — no `session/load` round-trip needed, we already hold the
  live state, and calling it would still stomp the ctx per the bug above.
- Return the buffered `activeTurn.patches` folded into `history` as the trailing
  in-progress assistant entry, plus a top-level `activeTurn: true` flag so the frontend
  knows to reattach for live continuation rather than treat this as settled history.

If no active turn exists, behavior is unchanged (normal `loadSession()` + replay path).

### 4. New reattach endpoint: `GET /chat/stream?sessionId=`

SSE, no request body. Looks up the session's `activeTurn`:

- Not found → `404`. This covers both "nothing was ever active" and the small race where
  the turn finishes between `/chat/init` reporting `activeTurn: true` and this request
  landing. In both cases the frontend treats it as a normal completed turn — no live tail
  is attached, and the next `/chat/init` will show the turn as settled history. No special
  handling needed beyond a plain 404.
- Found → write buffered `activeTurn.patches` as the initial batch, then set
  `activeTurn.viewerRes = res` (replacing any previous viewer — single-viewer/latest-wins)
  and clear any pending idle-reaper timer. Subsequent patches from the original,
  still-running `sendMessage()` generator are written to whichever `res` is currently
  `activeTurn.viewerRes`.
- On this connection's own `req.close`: if `activeTurn.viewerRes === res`, set it to `null`
  and start the idle-reaper timer (step 5). Do not cancel.

### 5. Idle-turn reaper

When `activeTurn.viewerRes` transitions to `null` (via either the original `/chat/send`
connection or a `/chat/stream` reattach disconnecting), start
`activeTurn.idleTimer = setTimeout(() => session.cancel(), GRACE_PERIOD_MS)`. Any new
attach (step 3/4) clears this timer. If it fires with still no viewer attached, call the
existing `session.cancel()` for real. `GRACE_PERIOD_MS` defaults to 5 minutes
(`JARVIS_BRIDGE_IDLE_TURN_GRACE_MS`, see Decisions above).

### 6. Frontend (`useChat.ts`)

`ctx.init()`'s handling of the `/chat/init` response gains an `activeTurn` branch: if the
response flags an active turn, instead of treating `history` as final, open
`GET /chat/stream?sessionId=` using the same `onPatch`/`onDone`/`onError` wiring
`sendMessage` already uses (`useChat.ts:62-92`), appending patches to the trailing
transcript entry (which is already an in-progress assistant bubble reconstructed from
`activeTurn.patches`) rather than starting a new one. `ctx.setBusy(true)` for the duration,
same as a live send.

### 7. Testing

- Backend (`node:test`, using `test/fixtures/fake-streaming-agent.cjs`):
  - Disconnect during a turn does not send `session/cancel` to the fake agent.
  - Reattach via `/chat/stream` after disconnect delivers buffered patches followed by
    live patches from the still-running turn.
  - `/chat/init` called mid-turn returns `activeTurn: true` and does not trigger a second
    `session/load`.
  - Idle-reaper test using fake timers: turn is cancelled after the grace period with no
    reattach; cancelled timer path when a reattach happens first.
- Frontend (`useChat.test.tsx`): `/chat/init` response with `activeTurn: true` causes the
  hook to open `/chat/stream` and append patches to the existing entry instead of
  resetting the transcript.

## Non-goals

- Multi-viewer broadcast (two tabs watching the same live turn simultaneously).
- Distinguishing "real" tab close from refresh via browser lifecycle events.
- Persisting in-flight turn state across a gateway process restart — `activeTurn` is
  in-memory only; a gateway restart mid-turn is out of scope (same as today).
