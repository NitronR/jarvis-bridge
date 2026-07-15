# /chat/init?sessionId=X loads on wrong backend after default switch

**Date:** 2026-07-14
**Session ID:** (none — opencode CLI session, no session ID assigned)

## Summary of work done

User reported: after changing the default backend in Settings and refreshing the
chat, the session tries to load against the new default backend instead of the
backend that created the session, and the load fails.

Their initial intuition was that the URL's `sessionId` was being routed to the
default backend only. The actual root cause was one level deeper: the
`findSession` / `listSessions` / `getSession` methods on `BackendRegistry` only
iterated backend pools that had already been spawned in the current process. The
default backend's pool is the only one spawned eagerly at startup; every other
profile is lazy-spawned on first `getBackend(name)` call. So a session owned by
a non-default backend whose pool had never been touched in this run (the typical
"gateway restarted with a different default than the one that created the
session" flow, or just "session was created on backend A, then user switched
default to B and the gateway restarted" in the original reproduction) was
invisible to the lookup.

That made `findSession(X)` return `null` for a perfectly valid session.
`server.ts`'s fallback then routed the load to the current default backend,
which dutifully tried `loadSession(X)` on its own agent subprocess — which has no
record of X — and returned an "Internal error" (500) from the agent adapter,
surfaced as a raw HTML stack trace to the browser.

Confirmed against the live gateway on :3001 by issuing
`PUT /settings/default-backend` for each transition and then `GET /chat/init?sessionId=…`
for both an opencode-owned and a claude-owned session. Same-direction
(default→owner) loads worked (the pool happened to still be in memory from
having been the original default at startup of the long-running process).
Cross-direction / post-restart loads would have failed — the test reproduces the
post-restart state by shutting down one registry and booting a fresh one with
the persisted default.

## Key decisions made

- **Fix in `BackendRegistry` (not `server.ts`).** The user-described symptom
  ("it loads with the new default") is misleading; the routing logic in
  `server.ts` already does the right thing *if* `findSession` returns the
  owner. The bug is in the lookup. Fixing it in `server.ts` (e.g. by spawning
  missing pools there) would duplicate the registry's lazy-spawn machinery.
- **`findSession` / `listSessions` / `getSession` now lazy-spawn every known
  profile's pool**, with `try`/`catch` around each spawn and each
  `backend.listSessions` call so one broken backend (e.g. crashed subprocess,
  missing CLI) doesn't fail the whole listing. `findSession` short-circuits on
  the first hit so a refresh doesn't have to ask every agent process for its
  full session list.
- **Did not touch the `server.ts` fallback.** When `findSession` truly returns
  null (session genuinely doesn't exist anywhere), the current behavior of
  falling back to the default and surfacing the agent's error is the right
  thing — the secondary "raw 500 with HTML stack trace" ugliness is real but
  not what the user asked to fix.
- **Did not archive `AGENTS.md` or `docs/acp-notes.md` first.** The cross-restart
  caveat in `acp-notes.md` and the corresponding sentence in `AGENTS.md`'s
  "Backend configuration" section now overstate the failure mode (they say the
  fallback uses the default backend's per-cwd instance — that's no longer hit
  for the un-spawned-pool case). The wording is misleading rather than wrong,
  so update-in-place is the right call; the prior wording was short enough not
  to warrant an archive.

## Files modified

| File | Change |
|------|--------|
| `src/agent/backendRegistry.ts` | `listSessions` / `findSession` / `getSession` now call `getPool(name)` for every profile (lazy-spawn), with per-profile `try`/`catch`. `findSession` short-circuits on first hit. |
| `src/server.test.ts` | New regression test (`GET /chat/init?sessionId=X reloads on the backend that owns the session, not the current default`) simulating the post-restart state: phase 1 creates a session on the eager default, switches the default, shuts down; phase 2 boots a fresh registry with the new default, then asserts `findSession` resolves the session to the original owner. Uses `X_FAKE_AGENT_SESSION_LIST` scoped to the owner's profile so the freshly-spawned subprocess reports the session (mirrors how a real agent CLI persists sessions across restarts). |

## Verification

- New test fails on the pre-fix code (`findSession` returns `null`), passes
  after the fix.
- `npm run typecheck` clean.
- `npm test`: 162/162 passing.
- Live verification: after restarting the gateway on :3001 with the fix, loading
  sessions owned by each backend works correctly across default-backend switches.

## Follow-up tasks / next steps

- Update `docs/acp-notes.md`'s cross-server-restart caveat — it still describes
  the old "falls back to default backend's per-cwd instance" failure mode, which
  no longer happens for the un-spawned-pool case.
- Update the corresponding bullet in `AGENTS.md`'s "Backend configuration"
  section so the documented invariant matches the new contract.
- The `server.ts` fallback when `findSession` truly returns null surfaces the
  underlying agent error as a raw 500 with an HTML stack trace. That's still
  rough UX (and shows up in the `accept: text/html` branch when curl doesn't set
  `Accept: application/json`), but it's a separate bug from what the user
  reported.
- Frontend `useChat.ts:189` `startNewChat` passes `ctx.state.backendName` (the
  *previous* session's backend) as the `backend` arg to `init()` — so after a
  default switch, clicking "New chat" creates the new session on the old
  default, not the new one. Not part of what the user reported but related to
  the same general confusion about which backend owns a given session.
