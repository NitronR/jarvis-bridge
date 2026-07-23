# Session Summary

**Date:** 2026-07-23

## Work Done

This session covered two major efforts: a Composer UI redesign (Tasks 1-6 + Follow-ups) and two bug fixes with logging infrastructure.

---

## Composer Redesign

Implemented the 6-task Composer redesign plan from `docs/superpowers/plans/2026-07-22-composer-redesign.md` plus 5 follow-up changes.

### Tasks 1-6

**Task 1 — Auto-resizing textarea**
- Added `useLayoutEffect` in `Composer.tsx` to auto-resize textarea up to `TEXTAREA_MAX_HEIGHT_PX=96`
- `rows={1}` always, height computed from `scrollHeight`
- Send button disabled when empty (`isEmpty = !text.trim() && attachments.length === 0`)

**Task 2 — QuickPhrasesRow overflow popup**
- Rewrote overflow button with proper button semantics, ARIA (`aria-haspopup="listbox"`, `aria-expanded`, `aria-label`)
- Keyboard close on Escape, focus returns to trigger
- `onBlur` closes popup when focus leaves

**Task 3 — Composer action row consolidation**
- Moved model selector and auto-approve button from InfoPanel into Composer's action row
- Actions split into `actionsLeft` (attach, model, auto-approve) and `actionsRight` (send/stop/queue/steer)
- Removed `modelSelect` CSS class from `Composer.module.css`

**Task 4 — ChatPanel cleanup**
- Deleted header buttons (model selector, auto-approve toggle, group selector)
- Removed `selectedModel`, `showAutoApprove`, `showGroup` state
- Removed `onModelChange`, `onAutoApproveToggle`, `onGroupChange` props
- Edge case: when models load after mount, model selector now renders with valid options
- Updated tests: removed `onModelChange`, `onAutoApproveToggle` from baseProps, removed model selector tests from ChatPanel

**Task 5 — InfoPanel model/auto-approve removal**
- Removed model selector row from InfoPanel
- Removed `onModelChange` prop from InfoPanel
- Updated InfoPanel tests (removed `onModelChange` from baseProps, removed model row tests)

**Task 6 — Docs update**
- Phase 4 marked Done in `docs/superpowers/plans/2026-07-22-composer-redesign.md`

### Follow-up Changes

**Follow-up 1 — Auto-approve removed from InfoPanel**
- Removed `onAutoApproveToggle` prop and auto-approve row from InfoPanel
- `InfoPanel.test.tsx`: removed `onAutoApproveToggle` from baseProps
- Result: 21/21 InfoPanel tests, 9/9 ChatPanel tests pass

**Follow-up 2 — Custom Select component (replaces native `<select>`)**
- Created `frontend/src/components/ui/Select.tsx` and `Select.module.css`
- Features: button trigger, dropdown listbox, keyboard navigation (arrows, enter, escape), ARIA, `data-testid` support for testing
- Options use `onMouseDown` with `e.preventDefault()` (not `onClick`) to avoid document-level mousedown listener conflicts
- Native `<select>` in Composer.modelSelector replaced with custom `<Select>`
- `Composer.module.css`: removed `.modelSelect` class
- 9 new Select tests using `data-testid` queries
- `ChatPanel.test.tsx`: model selector tests updated for custom Select, option selection via `fireEvent.mouseDown`

**Follow-up 3 — Select dropdown flips upward**
- Added `useLayoutEffect` to measure `getBoundingClientRect()` of trigger
- `placement: "top" | "bottom"` state, CSS classes `.listboxTop` / `.listboxBottom`
- Flips when insufficient space below (`spaceBelow < needed && spaceAbove > spaceBelow`)

**Follow-up 4 — Select trigger width grows to content**
- Removed `max-width: 180px` from trigger button in `Select.module.css`
- Removed `overflow: hidden; text-overflow: ellipsis` from `.triggerLabel`
- Dropdown `min-width: 100%` (removed `right: 0`)

**Follow-up 5 — Chat scrolls to bottom on page refresh**
- Changed `useEffect` to `useLayoutEffect` in `Transcript.tsx` for scroll-to-bottom
- Added `requestAnimationFrame` fallback for flex layout timing

### Files Changed (Composer Redesign)

- `frontend/src/components/Composer.tsx` — textarea auto-resize, model selector, auto-approve, send/stop/queue/steer
- `frontend/src/components/Composer.module.css` — action row layout, `.modelSelect` removed
- `frontend/src/components/Composer.test.tsx` — updated model selector tests for custom Select
- `frontend/src/components/ChatPanel.tsx` — removed model/auto-approve/group from header, props cleaned
- `frontend/src/components/ChatPanel.test.tsx` — updated for custom Select, removed header button tests
- `frontend/src/components/InfoPanel.tsx` — removed model selector, `onModelChange` prop
- `frontend/src/components/InfoPanel.test.tsx` — removed `onModelChange` from baseProps
- `frontend/src/components/Transcript.tsx` — `useLayoutEffect` + `requestAnimationFrame` for scroll
- `frontend/src/components/ui/Select.tsx` — new (custom Select component)
- `frontend/src/components/ui/Select.module.css` — new
- `frontend/src/components/ui/Select.test.tsx` — new (9 tests)
- `frontend/src/components/QuickPhrasesRow.tsx` — button semantics, ARIA, keyboard close
- `docs/superpowers/plans/2026-07-22-composer-redesign.md` — Phase 4 marked Done

---

## Model Persistence Fix

Model selection wasn't surviving page refreshes. Two bugs:

**Bug 1 — POST /chat/model response missing `current` field**
- `POST /chat/model` responded `{ ok: true }` without a `current` field
- Frontend `setModel` expected `res.data.current`, got `undefined`, set `currentModel` to `undefined`
- **Fix:** `res.json({ ok: true, current: body.modelId })` in `src/server.ts`

**Bug 2 — GET /chat/init built response BEFORE re-applying stored model override**
- Stored model override was re-applied via `.then().catch()` (fire-and-forget)
- `getSessionModels()` was called to build the response BEFORE the override was applied
- Frontend received agent's reported model (default), not the user's stored choice
- **Fix:** `await` the re-apply so `getSessionModels()` returns the correct model

**Files changed:**
- `src/server.ts` — fixed POST response, changed re-apply to `await`
- `src/agent/sessionConfigStore.ts` — added `getModelOverride`/`setModelOverride`
- `src/agent/acp/index.ts` — debug logs (ACP setSessionModel, loadSession, createSession)

---

## Dual-Sink Logging Infrastructure

Both backend and frontend logs write to terminal + file.

**Backend (`src/logger.ts`):**
- Overrides global `console.*` methods to tee to stderr + file
- File path from `JARVIS_BRIDGE_LOG_FILE` env var, defaults to `<systemDir>/logs/gateway.log`
- `initLogger()` + `installConsoleOverride()` called early in `src/index.ts`

**Frontend (`frontend/src/clientLogger.ts`):**
- Batches console output, POSTs to `POST /chat/client-logs` every 1s or 50 entries
- Server writes to `frontend.log` (separate from `gateway.log`)
- `installClientLogger()` called in `frontend/src/main.tsx`

**Files changed:**
- `src/logger.ts` — new
- `src/config.ts` — added `logFile` field
- `src/index.ts` — `initLogger()` + `installConsoleOverride()`
- `src/server.ts` — added `logFile` to `CreateServerOptions`, added `POST /chat/client-logs` endpoint
- `frontend/src/clientLogger.ts` — new
- `frontend/src/main.tsx` — `installClientLogger()` call
- `.env.example` — documented `JARVIS_BRIDGE_LOG_FILE`

**Log files:**
- Backend: `~/.jarvis-bridge-system/logs/gateway.log`
- Frontend: `~/.jarvis-bridge-system/logs/frontend.log`

---

## Key Decisions

1. **Model persistence uses session_metadata.json** — same pattern as auto-approve override; no new files
2. **Frontend logs go to separate frontend.log** — keeps gateway.log clean for grep
3. **`await` not `.then()` for re-applied overrides** — any future re-applied overrides should use `await` to avoid the same race condition
4. **Select uses `onMouseDown` not `onClick`** — avoids conflict with document-level mousedown listener for click-outside
5. **`data-testid` for Select testing** — accessible name doesn't work (`getByRole("button", { name: "Model" })` fails because text content overrides aria-label), must use `data-testid="select-model"`

## Tests

- Backend: 43/43 pass
- Frontend: 29 test files, 255/255 pass (pre-existing URL parse errors in ChatContext.test.tsx, unrelated)
- ACP idle-turn reaper test (1 pre-existing failure in src/agent/acp/index.test.ts) is unrelated

## Pre-existing Issues (not introduced this session)

- `Transcript.tsx` RefObject type errors in typecheck
- `ChatContext.test.tsx` unhandled URL parse errors
- ACP idle-turn reaper test failure
