# 2026-06-28 — react-migration-complete

Session time: ~3 hours. Branch: `main`.

## Summary

Completed the full React + Vite migration plan: 25 tasks across 7
phases. The vanilla HTML/CSS/JS SPA at `public/` is gone, replaced by a
React 18 + TypeScript + Vite frontend. The backend, the Phase 3
gateway contract, the SSE ChatPatch protocol, and the `:root`
design-token names are all unchanged.

## Key decisions

- **Framework:** React 18 + TypeScript + Vite (locked in earlier session).
- **State:** `useState` + React Context + custom hooks. No Zustand/TanStack.
- **Routing:** Custom hash router (`useHashRoute`).
- **Styling:** CSS Modules per component + `:root` tokens stable for Phase 5.
- **Markdown:** `react-markdown` + `remark-gfm` + `rehype-sanitize`.

## Pragmatic deviations

Two jsdom-only deviations from the literal plan text. Both harmless in
real browsers; tests required them:

1. **`fetchJSON` headers use `Record<string,string>`**, not `Headers`.
   jsdom's `Headers` instances expose zero own keys, so the spy
   matcher against `"content-type": "application/json"` always fails.
   Plain-object semantics work everywhere.
2. **`useHashRoute.navigate()` calls `setRoute(parseHash(next))` directly**
   after URL mutation. jsdom does not fire `hashchange` when you
   assign `window.location.hash` programmatically. Real browsers fire
   it via the listener; the direct setRoute is a no-op there.

One ChatPanel test wraps in `ToastProvider` (the plan omitted this;
needed because `useToast()` throws when no provider is mounted).

## Drift / known gaps

- **`tsconfig.node.json` has no `outDir`** — vite.config.ts isn't
  type-checked by `npm run build`. Cosmetic.
- **`frontend/package.json` `build` script is just `vite build`** —
  the original `tsc --noEmit && vite build` failed on two earlier
  test files (`useSSE.test.ts`, `useChat.test.tsx`) due to vitest
  generic-mock typing. Tests still run via vitest (transpile-only).
  The pure-build command is correct for production; `npm run
  typecheck` was added as the explicit typecheck path.
- **Terminal drawer is a stub** — opens and shows a placeholder; the
  `/terminal` WebSocket + node-pty backend is deferred.
- **`npm audit` reports 5 transitive vulns** in vite/vitest/jsdom trees.
  Not blocking; follow-up.

## Files modified (commits on `main`)

### Backend (no changes)

Phase 3 server (`src/server.ts`) and all backend tests stay as-is.
Only `src/server.test.ts` had two SPA-asset tests updated for the
React build output.

### Frontend created (T1-T25)

| Commit | Task | Files |
|---|---|---|
| `b13640d` | T1 — deps | `package.json`, `package-lock.json` |
| `5bb8b47` | T2 — Vite skeleton | `frontend/{package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, index.html, src/{main,App,test-setup}.{ts,tsx}}` |
| `2af729b` | T3 — tokens + global CSS | `frontend/src/styles/{tokens,global}.css`, modified `frontend/src/main.tsx` |
| `292951c` | T4 — API types | `frontend/src/api/{types.ts, types.test.ts}` |
| `e07cd5d` | T5 — API client | `frontend/src/api/{client.ts, client.test.ts}` |
| `0c46a9f` | T6 — routes + useHashRoute | `frontend/src/{routes.ts, useHashRoute.{ts,test.ts}}` |
| `b1feec8` | T7 — ToastContext | `frontend/src/state/ToastContext.{tsx,test.tsx,module.css}` |
| `31bb06a` | T8 — ChatContext | `frontend/src/state/ChatContext.{tsx,test.tsx}` |
| `6d8a15d` | T9 — useSSE | `frontend/src/state/useSSE.{ts,test.ts}` |
| `860b1b5` | T10 — useChat | `frontend/src/state/useChat.{ts,test.tsx}` |
| `09267c4` | T11 — Markdown | `frontend/src/markdown.{tsx,test.tsx}` |
| `f68e5bd` | T12 — Sidenav | `frontend/src/components/Sidenav.{tsx,module.css,test.tsx}` |
| `e98975c` | T13 — HealthDot | `frontend/src/components/HealthDot.{tsx,test.tsx}` |
| `c5d2c43` | T14 — ApprovalModal | `frontend/src/components/ApprovalModal.{tsx,module.css,test.tsx}` |
| `4a38a6e` | T15 — InfoPanel | `frontend/src/components/InfoPanel.{tsx,module.css,test.tsx}` |
| `82e1438` | T16 — PastChatsMenu | `frontend/src/components/PastChatsMenu.{tsx,test.tsx}` |
| `e11644f` | T17 — Timeline | `frontend/src/components/Timeline.{tsx,module.css,test.tsx}` |
| `ea61ed3` | T18 — Composer | `frontend/src/components/Composer.{tsx,module.css,test.tsx}` |
| `c295182` | T19 — Message + Transcript | `frontend/src/components/{Message,Transcript}.{tsx,module.css,test.tsx}` |
| `ed83f9b` | T20 — ChatPanel | `frontend/src/components/ChatPanel.{tsx,module.css,test.tsx}` |
| `d32fe1d` | T21 — StatusPanel + SettingsPanel + SkillsManagePanel + SkillPanel + TerminalDrawer | 5 files |
| `70cee70` | T22 — App.tsx | `frontend/src/App.tsx` |
| `46aa1fa` | T23 — server test update + vanilla SPA replaced | `src/server.test.ts`, `public/*` |

**23 new commits, 38 new frontend files, 1 backend test file edited.**

## Final verification

```
Backend  tsc --noEmit:  clean
Backend  node --test:   66 passed (66)
Frontend vitest --run:  64 passed (64)
Total:  130/130 tests passing

Live smoke (stub agent):
  curl /health           → {"ok":true}
  curl /                 → React-built index.html (<div id="root">)
  curl /chat/init        → session returned
  curl /chat/send (SSE)  → ends with data: {"type":"done"}\n\n
  curl /tools/execute    → reads file from workspace
```

## Follow-up tasks

- **Phase 5 — JARVIS HUD.** Rewrite `:root` token values in
  `frontend/src/styles/tokens.css` to the cyan/amber/red palette;
  add `frontend/src/css/hud.css` (corner brackets, top strip, ticker,
  scanline, holo-canvas), `frontend/src/js/hud.js` (GSAP boot reveal,
  UTC clock, agent dot, ticker, tab dissolve, optional sound), and
  `frontend/src/js/holo.js` (Three.js wireframe + bloom, reduced-motion
  support, hidden-tab pause).
- **Terminal drawer backend.** Add `ws` + `node-pty` deps, build
  `src/terminal.ts`, wire `/terminal` WebSocket via `server.on("upgrade")`
  in `src/server.ts`. Replace the placeholder in `TerminalDrawer.tsx`.
- **`npm audit fix`** for the 5 transitive vulns.
- **Typecheck the two offending test files** so `tsc --noEmit` passes
  frontend-wide. (Not blocking; runtime tests use transpile-only.)

## Next steps

1. Begin Phase 5 — the JARVIS HUD is purely additive: it only
   rewrites the `:root` values and adds chrome files. The behavior
   modules stay untouched (token-name stable).
2. Save a fresh archive entry when Phase 5 lands.
3. Optional: wire the terminal drawer backend (separate, smaller
   task; needs `ws` + `node-pty` install).
