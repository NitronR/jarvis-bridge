# New-tab model handoff 500 — debugging session

Date: 2026-07-15

## Summary

User reported that cmd/ctrl-clicking "+ New" opens a new tab with `cwd`/`backend`/`model`
URL params, but the params were immediately stripped, the URL fell back to bare
`localhost:5173`, and the session never loaded (model field blank, fork button disabled).

Initial hypothesis was a React StrictMode double-invoke race in `ChatProvider`'s mount
effect (two concurrent `/chat/init` calls reading the same un-stripped URL params before
either resolved). Added a `didInitRef` guard to `frontend/src/state/ChatContext.tsx` to rule
this out — confirmed via console logging that the guard correctly prevented a second `init()`
call on StrictMode's replay, but the bug persisted, so this wasn't the actual cause (though the
guard is a real fix for a real latent race and was kept).

Added temporary `[chat-init-debug]` console logging across `ChatContext.tsx` (`init()`,
`setSessionIdInUrl()`, mount effect) and `useChat.ts` (`openNewChatInNewTab`) to trace the
actual request/response. User reproduced and pasted browser console output, which showed the
real signal: `/chat/init` returned **HTTP 500**, not a client-side URL-handling bug at all.

Reproduced directly against the running backend with `curl` to get the untruncated stack
trace (the browser's error body was truncated in the console):

```
AcpRequestError: "Method not found": session/set_model
    at AcpConnection.handleLine (src/agent/acp/jsonrpc.ts:255:18)
```

Root cause: `src/server.ts`'s `/chat/init` route calls
`backend.setSessionModel?.(session.id, q.model)` for the URL-param model handoff with no
`try`/`catch`. The Claude ACP backend doesn't support `session/set_model`, so the rejection
propagated uncaught and 500'd the whole request. The frontend's existing (correct) error
handling in `init()` then tore down the session state and stripped the URL — which is what
made it *look* like a URL-stripping bug from the outside.

Two other call sites for the same method already handled this defensively:
- `AcpAgentBackend.createSession` pins `this.model` in a `try/catch { /* ignore */ }`.
- `POST /chat/model` wraps it in `try/catch` and returns a clean `400`.

Only the `/chat/init` query-param path was missing the guard.

## Key decisions

- Kept the `didInitRef` StrictMode guard in `ChatContext.tsx` even though it wasn't the root
  cause — it's a real fix for a real (if narrower) duplicate-init race.
- Fixed `/chat/init` by wrapping the `setSessionModel` call in the same tolerant `try/catch`
  pattern already used at the other two call sites, rather than inventing a new error-handling
  approach.
- Removed all `[chat-init-debug]` console logging after root-causing — it was diagnostic only.
- Documented the gotcha in `docs/acp-notes.md` under the existing `/chat/init` section, since
  it's the same class of bug already tracked there (backend-specific ACP method support
  varying silently) and future backends will hit the same trap if a new call site skips the
  guard.

## Files modified

- `src/server.ts` — wrapped `setSessionModel` call in `/chat/init` in `try/catch`.
- `frontend/src/state/ChatContext.tsx` — added `didInitRef` StrictMode guard (kept); debug
  logging added then removed.
- `frontend/src/state/useChat.ts` — debug logging added then removed.
- `docs/acp-notes.md` — added a bullet under the existing `/chat/init` section.

## Follow-up / next steps

- None outstanding — user restarted the backend and confirmed the new-tab flow now works
  end-to-end (URL params consumed, model shown, fork button enabled).
- Worth a sweep (not done here) for any other `backend.<optionalMethod>?.()` call sites in
  `server.ts` that assume every backend implements every optional method without a
  `try`/`catch` — this bug class (unguarded optional ACP method call) could recur elsewhere.
