# Composer Redesign

## Overview

Redesign `Composer.tsx` (Phase 4 of the frontend redesign — see
`docs/design/redesign-phases.md`) to fix the usability findings from a Stage 2 heuristic
audit and to consolidate turn-related controls that are currently scattered across
`ChatPanel`'s header, `InfoPanel`, and `Composer` itself into one place: the Composer.

**Driver**: Phase 4 was "Not started" pending a heuristic audit (per
`docs/guidelines/ui-ux-process.md` stage 2). That audit found one critical accessibility bug
(quick-phrases overflow is keyboard/touch-unreachable), four major issues (color-only context
warning, no persistent send-mode indicator, inconsistent empty-input handling between
Send/Queue, missing `aria-label` on the attach button), and several minor issues (raw
`<button>`s not on the `Button` primitive, hardcoded px values instead of tokens, no
auto-resize on the textarea). Separately, the user asked to relocate Steer, Auto-approve, and
model selection into the Composer for a single "everything about the current turn or its
composition lives near the input" surface.

**Layout direction**: cross-referenced against `docs/research/opensource-composers.md` and the
actual source of the three real projects it summarizes (Happy, Codeg, ACP-UI). Happy and
Codeg — the two with a comparably rich control set — both converge on **one action row below
the textarea**, split into a left "configuration" cluster and a right "primary action"
cluster, rather than separate rows per control category. This design follows that convergent
pattern instead of a bespoke multi-row layout.

**Non-goals** (explicitly out of scope for this spec):
- `InfoPanel` gets no changes beyond removing the model selector it's giving up. No other
  `InfoPanel` audit/redesign work (that's the other half of the original "Phase 4: Composer +
  Info Panel Audit" entry, explicitly deferred — Phase 4 is scoped to Composer only).
- No slash commands, rich text editing, or fork/branch split-button — not requested, not a gap
  named in the audit.
- No responsive popover-collapse of the action row's left cluster at narrow widths (Codeg's
  gear-menu pattern) — `flex-wrap` is the first-pass answer; a collapse pattern is a future
  enhancement only if wrapping proves visually unacceptable in practice.
- No changes to `ChatPatch`, `MessageEntry`, or any backend/API contract — this is a
  presentational and prop-threading change only.

**Dependency**: builds on the `Button` primitive from
`docs/superpowers/specs/2026-07-21-design-system-design.md` (`frontend/src/components/ui/`)
and the grouping precedent set by
`docs/superpowers/specs/2026-07-21-header-toolbar-cleanup-design.md`.

## Current State

`Composer.tsx` renders four rows in a `<form>`: attachments (when present), `QuickPhrasesRow`,
a `.row` containing the textarea + an `.actions` div (Attach, Send/Stop, Queue, Steer), and a
context/cost status line. Model selection lives in `InfoPanel.tsx:167-171` as a `<select>`
(hidden whenever the info panel is collapsed). Steer and Auto-approve toggles live in
`ChatPanel.tsx`'s header (`:461-476`) — Steer's header toggle is redundant with the toggle
`Composer.tsx:163-165` already renders for the same `steerEnabled` state.

Audit findings (severity-ranked, full detail in conversation history):

| Severity | Finding | Location |
|---|---|---|
| Critical | Quick-phrases overflow popup is hover-only — unreachable by keyboard or touch | `QuickPhrasesRow.tsx:114-133` |
| Major | Context-limit warning is color-only | `Composer.tsx:174`, `Composer.module.css:56` |
| Major | No persistent send-mode indicator (placeholder text vanishes once typing starts) | `Composer.tsx:127-133` |
| Major | Send silently no-ops on empty input; Queue is disabled for the same condition | `Composer.tsx:67` vs `:162` |
| Major | Attach button has `title` but no `aria-label` | `Composer.tsx:156` |
| Minor | Raw `<button>` elements, not the `Button` primitive | `Composer.tsx`, `QuickPhrasesRow.tsx` |
| Minor | Hardcoded px values instead of design tokens | `Composer.module.css:24,37,50` etc. |
| Minor | No auto-grow on the textarea | `Composer.tsx:124-142` |
| Minor | `.actions button { min-width: 80px }` applies even to the icon-only attach button | `Composer.module.css:48` |
| Minor | `QuickPhrasesRow` container has no `aria-label`/`role="group"` | `QuickPhrasesRow.tsx:93` |

## Design

### Row structure

1. **Attachments row** — unchanged, renders only when `attachments.length > 0`.
2. **Quick phrases row** — unchanged position; internals fixed (see below).
3. **Textarea** — auto-resizing (see below), replacing the fixed `rows={2}` box.
4. **Action row** — new, replaces today's `.row .actions` div and absorbs the header's Steer/
   Auto-approve and `InfoPanel`'s model selector:
   - **Left cluster (configuration)**: 📎 Attach → Model selector → Auto-approve. Grouped
     together because both Happy and Codeg treat attach and mode/model selection as
     compose-time configuration, not primary actions.
   - **Right cluster (primary action)**: isolated on the right like a dialog's confirm
     button — `Send` when idle; `Stop` + `Queue` + `Steer` coexisting when `busy` (Happy's
     coexistence style, not Codeg's silent single-slot swap, so Queue and Steer stay
     discoverable rather than hidden behind pressing Enter).
5. **Context/cost status line** — unchanged position and content, at the bottom. None of the
   three researched OSS composers show a token/cost meter in the composer at all, so this
   stays a jarvis_bridge-specific footer, kept visually separate from the button row rather
   than crammed into it.

### Textarea auto-resize

Replace the fixed `rows={2}` textarea with one that grows with content:

- On every `text` change, measure `scrollHeight` and set the textarea's `style.height` to
  `Math.min(scrollHeight, maxHeightPx)`, resetting to `"auto"` first so shrinking (e.g. after
  clearing the input) is measured correctly.
- Cap: approximately 4 lines (`min-height: 40px` as today, `max-height` computed from
  4 × line-height + vertical padding). Once content exceeds the cap, the textarea scrolls
  internally (`overflow-y: auto`) rather than continuing to grow.
- Note for context: the three researched OSS composers cap noticeably higher (Happy ~5-21
  lines depending on platform, Codeg ~10-15 lines via a CSS `max-height`); 4 lines is a
  deliberate, tighter choice here, not an oversight.
- Implemented as a plain `useLayoutEffect` keyed on `text` plus a ref — no new dependency
  (matches Codeg's dependency-free CSS approach in spirit, adapted to a plain `<textarea>`
  which needs the JS measurement step since it isn't a contentEditable block).

### Send-mode clarity

- Steer's button (`Composer.tsx:163-165`) becomes conditionally rendered on `busy &&
  steerSupported` instead of `steerSupported` alone, so it only appears "when responding," per
  the confirmed direction. See Edge Cases for the state-reset this requires.
- The placeholder-text mode hint (`Composer.tsx:127-133`) is kept as a secondary cue but is no
  longer the *only* signal — with Steer/Queue/Stop now visually distinct buttons in the action
  row's right cluster (rather than icon-only or ambiguous), which button is available already
  communicates mode without relying on placeholder text a user has typed over.

### Empty-input consistency

`Send` gets the same `disabled` treatment `Queue` already has: disabled when
`text.trim() === "" && attachments.length === 0`. Removes the silent no-op.

### Accessibility fixes

- Attach button: add `aria-label="Attach image"` alongside the existing `title`.
- Context warning (`Composer.module.css:56` `.warn`): add a non-color signal alongside the
  color change at >80% usage — bold weight plus a small `⚠` prefix glyph, so the signal
  doesn't rely on color alone (matching the precedent `Dot` already set in this codebase for
  the same reason).
- `QuickPhrasesRow` overflow (`QuickPhrasesRow.tsx:114-133`): convert the hover-only `<div>` to
  a real `<button>` with `aria-haspopup="true"` and `aria-expanded`. Opens on click, closes on:
  click-outside, `Escape`, or blur — mirroring the existing `cancelAdd`-on-blur pattern already
  used by the row's own "add phrase" input.
- `QuickPhrasesRow` container (`:93`): add `role="group" aria-label="Quick phrases"`.

### Component primitive migration

All raw `<button>` elements in `Composer.tsx` and `QuickPhrasesRow.tsx` move onto the `Button`
primitive (`variant="primary"` for Send, `variant="danger"` for Stop, default variant for
everything else) — the deferred item named in `docs/frontend-components.md`. `.actions button
{ min-width: 80px }` is dropped in favor of `Button`'s own sizing, which doesn't force
icon-only buttons to text-button width.

### Token cleanup

`Composer.module.css`'s hardcoded values move onto existing tokens (no new tokens needed,
matching the header-toolbar-cleanup spec's precedent of working within the existing scale):

| Raw value | Token |
|---|---|
| `font-size: 13px` (`.dropOverlay`) | `var(--font-size-4)` |
| `font-size: 12px` (`.attachment`) | `var(--font-size-3)` |
| `font-size: 11px` (`.contextBar`) | `var(--font-size-2)` |
| `padding: 8px 12px` (`.form`) | `var(--space-4) var(--space-6)` |
| `gap: 6px` (`.form`) | `var(--space-3)` |
| `gap: 8px` (`.row`) | `var(--space-4)` |
| `padding: 2px 0 0; gap: 4px` (`.contextBar`) | `var(--space-1) 0 0; var(--space-2)` |

### Architecture: prop threading, not context access

`Composer.tsx` stays a pure props-in/callbacks-out component — no `ChatContext`/hook access is
added, consistent with today's pattern and this repo's "presentational changes stay
presentational" rule (`docs/design/philosophy.md`). New props:

```ts
models: { modelId: string; name: string }[];
currentModel?: string;
onModelChange: (modelId: string) => void;
autoApproveEffective: boolean;
autoApproveCapable: boolean;
onAutoApproveToggle: () => void;
```

All six already exist as values/handlers in `ChatPanelInner` (`ChatPanel.tsx`) today, computed
for the header buttons and `InfoPanel` — this change re-threads them to `Composer` instead of
(Steer, Auto-approve) or in addition to (model — `InfoPanel` loses it) their current
destination.

### Files to modify

1. `frontend/src/components/Composer.tsx` — new action-row markup/grouping, auto-resize,
   empty-input disable on Send, Steer visibility condition, new props, `Button` migration,
   `aria-label` fix.
2. `frontend/src/components/Composer.module.css` — token cleanup, new action-row flex layout
   (`flex-wrap` for narrow widths), `.warn` non-color signal.
3. `frontend/src/components/QuickPhrasesRow.tsx` — overflow popup keyboard/touch fix, container
   `role`/`aria-label`, `Button` migration for add/delete/submit buttons.
4. `frontend/src/components/QuickPhrasesRow.module.css` — any styling adjustments needed for
   the overflow button's new click-driven open state (e.g. a pressed/active visual state).
5. `frontend/src/components/ChatPanel.tsx` — delete header Steer button (`:461-468`) and
   Auto-approve button (`:469-476`); thread the six new props into `<Composer>`.
6. `frontend/src/components/InfoPanel.tsx` — delete the Model `<select>` row (`:167-171`);
   `onModelChange` no longer threaded here.
7. `docs/frontend-components.md` — update the `Button` migration note (Composer no longer
   listed as not-yet-migrated).
8. `docs/design/redesign-phases.md` — mark Phase 4 "Done" with date and links, once shipped.

### No changes needed

- `ChatPatch` / `MessageEntry` / any backend API contract — purely presentational + prop
  re-threading.
- `Button.tsx` / `Button.module.css` — consumed as-is.
- `Transcript.tsx`, `ApprovalModal.tsx`, `ElicitationModal.tsx` — out of scope.

## Edge Cases

1. **Steer-armed-then-idle trap** (found while speccing, not present today): today Steer's
   button is always visible so a user can toggle it off anytime. Once it only renders while
   `busy`, if `steerEnabled` were still `true` when a turn ends, the button disappears while
   the state stays on — and `Composer`'s `dispatch()` (`Composer.tsx:37-41`) would silently
   route the *next* message through `onSteer` instead of `onSend`, with no visible control left
   to undo it. **Fix**: auto-reset `steerEnabled` to `false` whenever `busy` transitions
   `true → false`. This state lives in `ChatPanelInner` (`ChatPanel.tsx:98`), so the reset is a
   `useEffect` keyed on `chat.busy` there, not in `Composer`.
2. **Empty text + no attachments** — `Send` is now disabled (see above) instead of silently
   no-op'ing. `Queue`'s existing disabled behavior is unchanged.
3. **Model list empty** (`models.length === 0`) — selector disabled, matching `InfoPanel`'s
   current behavior, just relocated.
4. **Capability gates** (`steerSupported`, `imagesSupported`, `autoApproveCapable` all false) —
   corresponding control is `disabled`, not hidden, matching the existing convention (Attach and
   Auto-approve already work this way; Steer's *visibility* condition changes per point 1 above,
   but its *capability* gate does not — `steerSupported` continues to control whether it can
   ever render, `busy` controls whether it does right now).
5. **Context bar with no usage data** — hidden entirely, unchanged from today
   (`Composer.tsx:168` guard).
6. **Narrow viewport / InfoPanel open** — the action row's left cluster (Attach, Model,
   Auto-approve) may wrap onto a second line via `flex-wrap` rather than overflow or truncate.
   The right cluster (Send, or Stop+Queue+Steer) does not wrap — it's the smaller, higher-
   priority group and should stay on one line.
7. **Many quick phrases in overflow** — the overflow toggle button, once opened via click,
   stays open until explicitly closed (click-outside/Escape/blur) rather than closing the
   instant the pointer leaves it, since keyboard users have no "pointer leaving" event to rely
   on.
8. **Long model names** — the model selector was implemented with the custom `ui/Select.tsx`
   combobox rather than a native `<select>` (a mid-implementation direction change, reviewed
   and accepted post-hoc — see `docs/frontend-components.md`); overflow behavior for long
   names is whatever that component renders, not native `<select>` truncation.

## Testing

- `Composer.test.tsx`: auto-resize behavior (mocking `scrollHeight` in jsdom), Send
  disabled-when-empty, Steer only rendered while `busy` (including the auto-reset-on-turn-end
  case from Edge Case 1), model selector and auto-approve wiring/callbacks, attach
  `aria-label`, action-row wrap behavior at narrow widths (or a snapshot-level check if full
  layout testing isn't practical in jsdom).
- `QuickPhrasesRow.test.tsx`: keyboard reachability of the overflow toggle (Tab focuses it,
  Enter/Space opens it), Escape closes it, click-outside closes it, container has the expected
  `role`/`aria-label`.
- `ChatPanel.test.tsx` / `InfoPanel.test.tsx` (both exist today): update for the removed header
  buttons and removed model select; verify the six new props reach `<Composer>`.
- Run `cd frontend && npm run test:web`.
