# Health Status Re-render Fix

**Date:** 2026-07-30
**Session ID:** efa9d54e-35e4-4a2e-90d5-2ed1a9709bcb

## Summary

User noticed that when the backend goes unhealthy, "the page refreshes" — then clarified,
correctly, that it was a React re-render rather than an actual browser reload. Traced the
mechanism: `App.tsx` owned `healthOk` state (updated every 15s by `HealthDot`'s poll) and
passed it as a prop into `ChatPanel`. Nothing in that tree (`ChatPanelInner`, `Transcript`,
`Composer`, `InfoPanel`) was wrapped in `React.memo`, so every time health flipped
true↔false, the *entire* chat panel re-rendered just to recolor an 8px status dot.

Also separately investigated and ruled out an actual full-page-reload theory first — grepped
the whole repo for `location.reload`, livereload/nodemon-style browser-refresh wiring, and
Vite HMR full-reload-on-reconnect; found nothing that would explain a literal browser refresh,
which is what led to the user's follow-up clarification that it was "just" a re-render.

## Key decisions

- **Isolate the state into a context consumed by a single leaf, rather than memoizing the
  children.** Considered wrapping `Transcript`/`Composer`/`InfoPanel` in `React.memo` (cheaper
  to write) but rejected it as treating the symptom — it leaves the coupling in place and
  would need re-doing for every future heavy child added to `ChatPanel`. Moving `healthOk`
  into its own `HealthContext` with a single consuming leaf (`HealthStatusDot`) fixes the
  actual problem: the health dot has no relationship to chat state and should never be able
  to trigger a transcript re-render at all.

## Files modified

- `frontend/src/state/HealthContext.tsx` (new) — `HealthProvider` owns the `/health/agent`
  poll state (via `HealthDot`) and exposes it through `useHealthOk()`.
- `frontend/src/App.tsx` — wraps `AppInner` in `HealthProvider`; dropped the local `healthOk`
  state and the `healthOk` prop passed into `ChatPanel`.
- `frontend/src/components/ChatPanel.tsx` — dropped the `healthOk` prop from
  `ChatPanel`/`ChatPanelInner`; added `HealthStatusDot`, a small leaf that calls
  `useHealthOk()` and is the only thing in the header that re-renders on a health flip.
- `frontend/src/components/ChatPanel.test.tsx` — removed the now-unnecessary
  `healthOk={null}` prop from all `<ChatPanel />` render calls.
- `docs/frontend-components.md` — updated the `Dot` section's consumer note and added a new
  subsection documenting the context-over-prop pattern for peripheral, frequently-changing
  state, so the next person who wants to poll/stream something unrelated to chat state knows
  not to thread it through `ChatPanel` as a prop.

## Verification

- `npx tsc --noEmit`: only pre-existing, unrelated `Transcript.tsx` ref-type errors (confirmed
  present on `main` before this change via `git stash`).
- `npx vitest run src/components/ChatPanel.test.tsx`: same 3 pre-existing failures as on
  `main` (Auto-approve button, cached usage bar text) — confirmed unrelated by running the
  suite pre-change too. No new failures introduced.
- Did not manually verify in-browser with React DevTools "highlight updates" — flagged to the
  user as an outstanding manual check.

## Unrelated observations (not acted on)

While diagnosing, noticed uncommitted changes already present in the working tree that this
session did not make: a `POST /chat/sessions/fork` cwd-inheritance bug fix touching
`src/server.ts`, `src/server.test.ts`, `docs/acp-notes.md`, and `test/fixtures/fakeBackend.ts`,
plus an untracked `docs/superpowers/specs/2026-07-30-quick-phrases-ranking-design.md`. These
predate this session (repo was reported clean at session start) and were left untouched —
likely another concurrent session/tool working in the same repo.

## Follow-up / next steps

1. Manually verify in-browser with React DevTools "Highlight updates" that toggling backend
   health only re-renders `HealthStatusDot`, not `Transcript`.
2. Investigate the 3 pre-existing `ChatPanel.test.tsx` failures (Auto-approve button, cached
   usage bar) — looked like real drift, unrelated to this fix.
3. Confirm with whoever owns the fork-cwd fix (`src/server.ts` et al.) before it's committed,
   since it was found uncommitted and untouched by this session.
