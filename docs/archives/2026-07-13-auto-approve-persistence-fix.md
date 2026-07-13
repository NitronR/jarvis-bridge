# Auto-approve button review + persistence fix

**Date:** 2026-07-13
**Session ID:** `67ce2df8-0c9a-459b-a04b-51c670516ea4`

## Summary of work done

User asked for a review of the auto-approve ("AA") button's functionality. Traced the
full path: `ChatPanel.tsx` header button + `InfoPanel.tsx` toggle → `useChat.ts:setAutoApprove`
→ `POST /chat/auto-approve` (`src/server.ts`) → `AcpAgentBackend.setSessionAutoApprove`
(`src/agent/acp/index.ts`) → `effectiveAutoApprove()` consulted by the
`session/request_permission` handler, which picks an `allow_*`-kind option (not a
hardcoded `optionId`) to auto-approve tool calls.

The button wiring itself is correct. The bug was persistence:

- `AcpAgentBackend` holds `defaultAutoApprove` and each session's `autoApproveOverride`
  as plain in-memory fields — never touching `src/agent/sessionConfigStore.ts`
  (`SessionConfigStore`), which already had `getAutoApproveDefault/setAutoApproveDefault/
  getAutoApproveOverride/setAutoApproveOverride` fully implemented and unit-tested,
  persisting to a `session_metadata.json` file.
- `src/index.ts` (the real production entrypoint) never called `createSessionConfigStore`
  or passed `sessionConfig` into `createServer` at all — only `server.test.ts` did. So in
  a running gateway, `opts.sessionConfig` was always `undefined`.
- `docs/archives/2026-07-13-persistent-session-metadata.md` (an earlier same-day session)
  claims auto-approve state already lived in that on-disk file — that claim was stale/
  incorrect; only session metadata (customTitle/pinned/group) had been wired to the
  store, and even that wiring was dead in production due to the missing `index.ts` change.
- Separately, `BackendPool.getOrCreate` (per-cwd backend spawn) never seeded a new
  backend instance's auto-approve default from the pool's existing default — so opening
  a new workspace via "+ New in..." would silently reset auto-approve to `false`.

Net effect before the fix: toggling auto-approve worked for the life of the running
gateway process, but a restart (or opening a new workspace) silently lost the setting.

## Key decisions made

- User chose "fix both now" (wire `SessionConfigStore` into `src/index.ts` for session
  metadata persistence, and also route auto-approve persistence through the same store)
  over "flag only" or "partial fix."
- Left `docs/archives/2026-07-13-persistent-session-metadata.md` unedited per the
  archive-immutability convention (AGENTS.md: "don't edit after the fact") even though
  its claim about auto-approve persistence was wrong — this note supersedes it instead.
- Added a bullet to `AGENTS.md`'s "Backend configuration" section documenting
  `session_metadata.json`/`SessionConfigStore` and the "must be wired into index.ts"
  gotcha, since that file previously had zero mention of this persistence layer.

## Files modified

| File | Change |
|------|--------|
| `src/index.ts` | Constructs `sessionConfig` via `createSessionConfigStore` (seeded from `cfg.autoApprove`); seeds `createBackendRegistry`'s initial `autoApprove` from the persisted default; passes `sessionConfig` into `createServer`. |
| `src/server.ts` | `GET /chat/init` reseeds a freshly-spawned backend's per-session auto-approve override from the store; `POST /chat/auto-approve` persists both the default (no-sessionId branch) and per-session override (sessionId branch) through `opts.sessionConfig`. |
| `src/agent/backendPool.ts` | `getOrCreate` now seeds a newly-spawned per-cwd backend's auto-approve default from the pool's existing default backend, instead of leaving it at `false`. |
| `AGENTS.md` | New bullet documenting `session_metadata.json` / `SessionConfigStore` under "Backend configuration". |

## Verification

- `npm run typecheck` clean.
- `npm test`: 135/135 passing. One `src/agent/acp/jsonrpc.test.ts` failure seen on a
  single full-suite run was confirmed flaky and pre-existing (reproduced passing in
  isolation, and the full suite was clean both before and after this session's changes
  when re-run).
- Not verified: an actual live gateway restart with a real backend CLI (would require an
  authenticated `opencode`/`claude` login in this sandbox) — relied on the existing
  `sessionConfigStore` unit tests (round-trip across a fresh store instance) plus the
  `server.test.ts` cross-restart integration tests for session metadata, which exercise
  the identical persistence mechanism.

## Follow-up tasks / next steps

- `GET /chat/init` resumes a session via `registry.getDefaultBackend()` unconditionally,
  which appears to contradict `AGENTS.md`'s documented invariant that resume should route
  via `registry.findSession()` to the backend that actually created the session. Found
  during this review, confirmed pre-existing (present in HEAD, not part of any uncommitted
  diff), and left untouched — it's in the `src/agent/acp/index.ts` "don't-touch / read-first"
  zone by association and wasn't part of what the user asked to fix this session.
- Consider a real end-to-end smoke test: toggle AA in the UI, restart the gateway process,
  confirm the session still reports auto-approve on via `/chat/init`.
