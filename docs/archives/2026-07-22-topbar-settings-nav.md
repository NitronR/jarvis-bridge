# 2026-07-22: Replace left Sidenav with a TopBar gear button

**Time:** 2026-07-22, afternoon/evening session
**Session ID:** 2a6f4bcb-f65e-47aa-88e2-a9dde5b9c0aa

## Summary

Removed the frontend's left-hand navigation sidebar (`Sidenav`) entirely and replaced its
only-retained function — reaching Settings — with a gear-icon button in a new global
`TopBar` component.

## Key decisions

- User confirmed (via clarifying question) that dropping UI access to the `status` and
  `skills-manage` routes was acceptable — "not much use" per their framing. Those routes
  still exist in `frontend/src/routes.ts`'s `ROUTES` array and their panels
  (`StatusPanel`, `SkillsManagePanel`) are unchanged; they're just no longer reachable from
  any visible button, only by editing the URL hash directly.
- `TopBar` is a new global component (previously no such thing existed — each panel had
  its own local header). It's rendered once in `App.tsx`'s `AppInner`, above `<main>`, in a
  column flex layout (was a row flex with `Sidenav` + `main` side by side).
- The health indicator (`Dot`, previously inside `Sidenav`) was preserved and moved into
  `TopBar` rather than dropped — this wasn't explicitly requested but was judged a
  functional regression to lose silently.
- No icon library is installed in this frontend; the new gear icon follows the existing
  hand-rolled inline-SVG convention (see `InfoPanel.tsx`'s `SaveIcon`/`RefreshIcon`,
  `ChatsDrawer.tsx`'s `PinIcon`) rather than adding a dependency.
- Visual verification: installed Playwright + Chromium temporarily (`npm install --no-save
  playwright`, no lockfile change) to screenshot the running dev server, then uninstalled
  it afterward — no `chromium-cli` or existing browser automation tool was available in
  this environment.

## Files modified

- Deleted: `frontend/src/components/Sidenav.tsx`, `Sidenav.module.css`, `Sidenav.test.tsx`
- Added: `frontend/src/components/TopBar.tsx`, `TopBar.module.css`, `TopBar.test.tsx`
- `frontend/src/App.tsx` — removed `Sidenav` usage and the `sidenavCollapsed`
  state/localStorage plumbing (`SIDENAV_COLLAPSED_STORAGE_KEY` and helpers); switched the
  root layout from a row flex (`Sidenav` + `main`) to a column flex (`TopBar` above `main`).
- `frontend/src/styles/tokens.css` — removed the now-unused `--sidenav-w` token.
- `docs/frontend-components.md` — updated `Dot`'s consumer list (`Sidenav``TopBar`).
- `docs/guidelines/ui-ux-process.md` — updated two component-list mentions
  (`Sidenav``TopBar`) since those examples were now stale.

## Follow-up / next steps

- No current plan to restore Status/Skills-manage access from the UI; if that's needed
  later, the natural home is additional `TopBar` icon buttons (the user explicitly declined
  that option this session, choosing to drop them instead).
- Consider whether `useHashRoute` should redirect away from `status`/`skills-manage` if hit
  directly via URL, or whether leaving them silently reachable-by-hash is fine indefinitely.

---

# Session 2: Remove TopBar, settings modal, toolbar health dot, title history push

**Time:** 2026-07-22, late evening session

## Summary

Reversed the earlier session's TopBar by deleting it entirely. Moved the health status
indicator (`Dot`) into `ChatPanel`'s own header toolbar (left of the chat title, right of
the back button). Moved the settings gear icon into the same toolbar (right of the
Auto-approve button), opening a new modal dialog (`SettingsDialog`) instead of navigating
to a `#settings` route. Added `history.pushState` on every chat title change so the title
is recorded in browser history, plus a `popstate` listener so back/forward updates the
document title bar accordingly.

## Key decisions

- Settings is now a modal (`SettingsDialog`), not a route — `#settings` removed from
  `ROUTES`, the `"settings"` string removed from `App.tsx`'s route switch. This means
  settings can be opened/closed without losing the current chat view or hash state.
- `SettingsDialog` follows the existing `ApprovalModal` pattern: backdrop + centered dialog
  div, `role="dialog"`, `aria-modal="true"`, ESC and backdrop-click to close.
- `history.pushState` is used instead of `location.hash =` so every title change creates a
  real browser history entry. A `popstate` listener was added so back/forward navigation
  through these entries updates `document.title` correctly (the earlier `useHashRoute` hook
  doesn't listen for `popstate`).
- Pre-existing unhandled errors in `ChatContext.test.tsx` (fetch mock issue) are unrelated
  to these changes and were not addressed.

## Files modified

- Deleted: `frontend/src/components/TopBar.tsx`, `TopBar.module.css`, `TopBar.test.tsx`
- Created: `frontend/src/components/SettingsDialog.tsx`, `SettingsDialog.module.css`
- Modified: `frontend/src/components/ChatPanel.tsx` — health `Dot` before `<h1>`, gear
  button after Auto-approve, `settingsOpen` state, `history.pushState` on title change,
  `popstate` listener for back/forward.
- Modified: `frontend/src/components/ChatPanel.module.css` — removed `::before` accent bar,
  added `.settingsBtn` styling.
- Modified: `frontend/src/components/ChatPanel.test.tsx` — added `healthOk` prop, fixed
  Auto-approve button selector, added `/chat/auto-approve` mock response.
- Modified: `frontend/src/App.tsx` — removed `TopBar` import/usage, passes `healthOk` to
  `ChatPanel`, removed `"settings"` route case.
- Modified: `frontend/src/routes.ts` — removed `"settings"` from `ROUTES`.
- Modified: `frontend/src/useHashRoute.test.ts` — removed `"settings"` route test refs.
- Modified: `docs/frontend-components.md` — updated `Dot` consumer from `TopBar` to
  `ChatPanel`.
- Modified: `docs/guidelines/ui-ux-process.md` — removed `TopBar` from component lists.

## Follow-up / next steps

- Status and Skills-manage routes remain unreachable from the UI (unchanged from session 1).
- Consider whether `useHashRoute` should redirect away from `status`/`skills-manage` on
  direct URL hit.
