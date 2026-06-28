# 2026-06-28 — react-migration

Session time: ~2 hours. Branch: `main`.

## Summary

Decided to migrate the jarvis-bridge SPA from vanilla HTML/CSS/JS to
React 18 + TypeScript + Vite. Wrote a design spec and a 25-task
implementation plan, then executed the first 10 tasks via
subagent-driven development. The remaining 15 tasks (components,
ChatPanel, App wiring, server-test update, cleanup, live smoke) are
still pending.

## Key decisions

- **Framework:** React 18 + TypeScript + Vite. Chose over Vue/Svelte
  for ecosystem familiarity. Confirmed via brainstorming (1 question).
- **State:** `useState` + React Context + custom hooks. No Zustand, no
  TanStack Query. Single-user local app doesn't need a global store.
- **Routing:** Custom hash router (`useHashRoute` hook, ~30 lines).
  Five routes total (`chat`, `status`, `skills-manage`, `settings`,
  `skill/<name>`); a router lib is overkill.
- **Styling:** CSS Modules per component + keep the `:root` design tokens
  stable so Phase 5 (JARVIS HUD retune) still works.
- **Markdown:** `react-markdown` + `remark-gfm` + `rehype-sanitize`.
  ~50 KB gzipped, acceptable.
- **Project location:** `frontend/` (separate Vite project). Vite
  `build.outDir = '../public'` writes production output into the
  directory Express serves via `express.static`.
- **Dev workflow:** Two terminals — backend on `:3001`, Vite on
  `:5173` (proxies all 8 backend route prefixes). Not `concurrently`.
- **Execution mode:** Subagent-driven (one subagent per task, with
  spec compliance + code quality reviews).

## Drift / pragmatic deviations

Two jsdom-only deviations from the literal plan text (both kept, both
harmless in real browsers):

1. **`fetchJSON` uses `Record<string,string>` for headers**, not
   `Headers`. jsdom's `Headers` instances expose zero own keys, so
   `expect.objectContaining({"content-type": "application/json"})`
   in the spy assertion always fails. Plain-object semantics work
   for both browsers and jsdom.
2. **`useHashRoute.navigate()` calls `setRoute(parseHash(next))`
   directly** after the URL mutation. jsdom does not fire `hashchange`
   when you assign `window.location.hash` programmatically. Real
   browsers fire it via the listener, so this is a no-op there.

Both are documented in the prior implementer reports.

## Files modified

### Spec / plan (committed)

- `docs/superpowers/specs/2026-06-28-react-frontend-migration-design.md`
  (a9e947f) — design doc, reviewed via plannotator (no feedback).
- `docs/superpowers/plans/2026-06-28-react-frontend-migration.md`
  (2260fbc) — 25-task implementation plan, 4251 lines.

### Backend (no changes)

The Phase 3 server contract is unchanged. `src/server.ts` and the
existing 60+ backend tests stay.

### Frontend created (Tasks 1-10)

| Commit | Task | Files |
|---|---|---|
| b13640d | 1 — deps | `package.json`, `package-lock.json` |
| 5bb8b47 | 2 — Vite skeleton | `frontend/{package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, index.html, src/{main,App,test-setup}.{ts,tsx}}` |
| 2af729b | 3 — tokens + global CSS | `frontend/src/styles/{tokens,global}.css`, modified `frontend/src/main.tsx` |
| 292951c | 4 — API types | `frontend/src/api/{types.ts, types.test.ts}` |
| e07cd5d | 5 — API client | `frontend/src/api/{client.ts, client.test.ts}` |
| 0c46a9f | 6 — routes + useHashRoute | `frontend/src/{routes.ts, useHashRoute.{ts,test.ts}}` |
| b1feec8 | 7 — ToastContext | `frontend/src/state/ToastContext.{tsx,test.tsx,module.css}` |
| 31bb06a | 8 — ChatContext | `frontend/src/state/ChatContext.{tsx,test.tsx}` |
| 6d8a15d | 9 — useSSE | `frontend/src/state/useSSE.{ts,test.ts}` |
| 860b1b5 | 10 — useChat | `frontend/src/state/useChat.{ts,test.tsx}` |

**10 new commits, 21 new frontend files. All tests pass (TDD; ~14+12
tests green across the foundation + state layers).**

`public/` was deliberately kept as the vanilla SPA throughout this
session — Vite's `build.outDir: "../public"` + `emptyOutDir: true` will
clobber it when `npm run build:web` runs (intentional, in Task 24).

## Follow-up tasks

Remaining from the plan (15 tasks):

- **T11** — `frontend/src/markdown.tsx` (react-markdown wrapper)
- **T12** — `frontend/src/components/Sidenav.{tsx,module.css,test.tsx}`
- **T13** — `frontend/src/components/HealthDot.{tsx,test.tsx}`
- **T14** — `frontend/src/components/ApprovalModal.{tsx,module.css,test.tsx}`
- **T15** — `frontend/src/components/InfoPanel.{tsx,module.css,test.tsx}`
- **T16** — `frontend/src/components/PastChatsMenu.{tsx,test.tsx}`
- **T17** — `frontend/src/components/Timeline.{tsx,module.css,test.tsx}` (the patch→DOM renderer)
- **T18** — `frontend/src/components/Composer.{tsx,module.css,test.tsx}`
- **T19** — `frontend/src/components/{Message,Transcript}.{tsx,module.css,test.tsx}`
- **T20** — `frontend/src/components/ChatPanel.{tsx,module.css,test.tsx}` (composes everything)
- **T21** — StatusPanel + SettingsPanel + SkillsManagePanel + SkillPanel + TerminalDrawer
- **T22** — `frontend/src/App.tsx` (router + provider stack + Sidenav)
- **T23** — Update `src/server.test.ts` SPA-asset assertions for React build output
- **T24** — Delete vanilla SPA files; run full typecheck + test suite
- **T25** — Live smoke (`curl /`, `curl /chat/init`, `curl /chat/send` SSE) + final commit

Other open items:

- **`npm audit`** reports 5 transitive vulns (3 moderate, 1 high, 1
  critical) in vite/vitest/jsdom trees. Not blocking but worth a
  separate task.
- **Phase 5 (JARVIS HUD)** is unchanged — it's a token retune + new
  chrome files, on top of whatever Phase 4 ships.

## Next steps

1. Resume execution from T11. Either continue with subagent-driven
   (faster, but each batch needs ~3 dispatches) or switch to inline
   execution in this session to save on context cost.
2. When all 25 tasks are done, the React build lands in `public/`
   and `npm run dev` (backend) + `cd frontend && npm run dev` (Vite)
   becomes the new dev workflow.
3. Run `npm audit fix` (separately, or with `--force`) to address the
   transitive vulns.
4. Save a fresh archive entry when Phase 4 is fully complete.
