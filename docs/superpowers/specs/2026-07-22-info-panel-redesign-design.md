# Info Panel Redesign

## Overview

Redesign `InfoPanel.tsx` — the next entry in the frontend redesign effort (see
`docs/design/redesign-phases.md`), following Phase 1 (Design System), Phase 2 (Transcript),
Phase 3 (Header/Toolbar), and Phase 4 (Composer, spec written but not yet implemented).

**Driver**: no prior heuristic audit had been run against `InfoPanel` — the Composer spec
explicitly deferred it ("no `InfoPanel` audit/redesign work... explicitly deferred"). This
round was prompted directly by the user: the panel currently "feels flat and dull," not
elegant or user-friendly. A quick pass against the current code (see Current State below)
grounded that complaint in specifics before any visual direction was chosen, per this repo's
"vague briefs" rule (`docs/design/philosophy.md`).

**Scope**: restyle *and* restructure — the user explicitly opted into reconsidering grouping/
hierarchy, not just visual polish on the existing structure.

**Dependency on Phase 4 (Composer)**: this spec designs `InfoPanel` as if Phase 4 has already
shipped — the Model selector and Auto-approve toggle are dropped from this file entirely, on
the assumption (confirmed by the user) that relocating them to `Composer` is a near-term
certainty. If Phase 4 is deprioritized or changes shape before this ships, removing those two
rows from this spec's implementation is a small follow-up, not a re-design.

**Non-goals**:
- No changes to `Composer.tsx` or `ChatPanel.tsx`'s header buttons/layout — this spec is
  `InfoPanel.tsx`/`InfoPanel.module.css`/`InfoPanel.test.tsx`, a one-line prop-passing removal
  in `ChatPanel.tsx` (forced by `InfoPanelProps`'s shrinking shape — see Files to Modify), and
  two doc updates. No other file's redesign scope is touched.
- No new shared `ui/` primitive for the usage meter (see Token & Component Reuse) — it has one
  consumer today.
- No changes to `ChatState`, `UsageTotals`, or any backend/API contract — presentational and
  prop-shape only. The two props being dropped (`onModelChange`, `onAutoApproveToggle`) are a
  prop-shape change, not a data/contract change — they're already unused once Phase 4 ships.
- No changes to the Add-Group dialog's interaction pattern (modal, autofocus, Enter-to-create)
  — token/color cleanup only.

## Current State

`InfoPanel.tsx` renders four bordered `.card` divs in a vertical scroll, all with identical
visual weight (same background, border, radius, uppercase muted 11px header):

1. **Current chat** — Title (`<input>` + always-visible save button), Group (`<select>`),
   Pinned (icon toggle button).
2. **Overview** — Workspace path, Model `<select>` (to be removed per Phase 4), Auto-approve
   toggle (to be removed per Phase 4).
3. **Session** — Session ID, Slash cmds count.
4. **Usage** (conditionally rendered) — per-window rate-limit rows with `%`, color-only warning
   at ≥80% (`.val.warn`), reset time, session cost, refresh button.

Plus an Add-Group modal dialog (backdrop + centered form) triggered from the Group `<select>`.

**Concrete findings behind "flat and dull"** (informal pass, not a full Nielsen audit — driver
was a direct user complaint, not a scheduled audit cycle):
- Every card has identical visual weight — nothing signals what matters more.
- Almost entirely text rows of `key: value` with no icons/accents — reads as a spec sheet.
- `.val.warn` (Usage ≥80%) is color-only, the same issue class flagged in the Composer audit
  for its context-limit warning.
- The Pin button's `--color-warning` accent when active is the only spot of color in the whole
  panel outside the Usage warning.

## Design

### Content structure & order

Three sections, replacing today's four cards, no card chrome (see Visual Language below).
Order follows the user's own ranking of why they open this panel (chat identity/organizing,
then usage, then confirming context):

1. **Chat identity** — Title (click-to-edit — see Interaction Patterns), Group (`<select>`,
   unchanged control), Pinned (icon toggle). Content unchanged from today's "Current chat"
   card, position unchanged (still first).
2. **Usage** — unchanged content (rate-limit rows, cost, refresh), each row gains an inline
   meter (see Visual Language). Moves up from last to second.
3. **Session & workspace** — Workspace path, Session ID, Slash cmds count. **Merges today's
   separate "Overview" and "Session" cards** (once Model/Auto-approve are removed, "Overview"
   would otherwise be a single-row section) — the user named these as one mental bucket
   ("confirming session/workspace context"), not two.

### Visual language

- **Typography-driven hierarchy, no boxed cards.** Title is the largest text in the panel
  (`--font-size-6`, `--font-weight-semibold`) — it's what's read/edited most often. Section
  labels shrink to a small uppercase micro-label (`--font-size-1`, `--color-text-muted`),
  same information as today's card `<h3>` but no longer inside a bordered box.
- **Hairline dividers** (`border-top: 1px solid var(--color-border)`) replace card
  backgrounds/borders between the three sections; spacing (`--space-8`/`--space-9`) does the
  separating work.
- **Meters for rate-limit rows**: each Usage row gets a thin (`4px`, `--radius-full`)
  horizontal bar next to its percentage. Fill color follows the same three-tier threshold the
  `%` text already uses today (`--color-success` / `--color-warning` / `--color-danger`), track
  in `--color-surface-3`. This is new visual language for this file but reuses existing tokens.
- **No new icons.** No iconography added to section headers — the existing hand-rolled icons
  (save, refresh, pin) are kept exactly where they already earn their place; no decoration
  without a reason, per `docs/design/philosophy.md`.
- **Non-color-only warning signal**: `.val.warn` at ≥80% usage gets a bold weight and a small
  `⚠` prefix glyph alongside its existing color change, closing the same accessibility gap the
  Composer spec fixed for its own color-only warning.
- **Hierarchy comes from order only, not emphasis** — per the user's explicit choice, Usage
  gets no extra visual weight over Chat Identity or Session & Workspace; all three read at the
  same type scale/color, differentiated only by their fixed top-to-bottom order.

### Interaction patterns

- **Title: click-to-edit.** Replaces the always-visible `<input>` + save button. Renders as
  plain heading-styled text with a subtle pencil affordance on hover/focus. Activating (click,
  or `Tab` + `Enter`/`Space` — see Accessibility) swaps to an inline `<input>` with autofocus.
  `Enter` or blur commits; `Escape` reverts to the last saved value without committing.
- **Group**: stays a native `<select>`, same "+ Add Group…" trigger and modal, unchanged
  behavior — only its border/background styling changes to drop the default boxed look in
  favor of the flatter surrounding language.
- **Pinned**: stays an icon-only toggle, same click behavior and `--color-warning` active
  state, loses its bordered-button chrome (`border: 1px solid var(--color-border)`) to match
  the de-carded style.
- **Usage refresh**: unchanged icon button + spin animation, repositioned next to the "Usage"
  section label instead of inside a `.cardHeader` div (which no longer exists).
- **Add-Group dialog**: unchanged interaction; only token/color cleanup to match the rest of
  the file (no new modal pattern, no new interaction).

### Accessibility

- Non-color warning signal (above) closes the one real gap this pass found.
- Title click-to-edit must be keyboard-operable: the static-text state gets `tabIndex={0}` and
  `role="button"` with an `aria-label` (e.g. "Edit title"), so `Tab` reaches it and
  `Enter`/`Space` opens edit mode — a hover-only pencil icon would be the same class of bug the
  Composer spec's quick-phrases fix addressed.
- Meters get `role="progressbar"` with `aria-valuenow`/`aria-valuemin={0}`/`aria-valuemax={100}`
  so a screen reader gets the percentage, not just a decorative bar.
- Existing `aria-label`s on save/pin/refresh buttons are unaffected (save button itself is
  removed as part of the click-to-edit change; pin/refresh keep theirs).

### Token & component reuse

- No new tokens — spacing/type/color come entirely from the existing scale (`--space-*`,
  `--font-size-*`, `--color-*`), consistent with how the Composer and header-toolbar redesigns
  worked within the existing scale rather than growing it.
- The rate-limit meter is new visual language but **not** a new shared `ui/` primitive — it has
  exactly one consumer (`InfoPanel`) today. Per this repo's "only tokenize/extract what
  actually repeats" rule, it's built as local CSS in `InfoPanel.module.css`. Worth revisiting as
  a shared primitive if a second consumer appears later — flagged here rather than built
  speculatively now, the same way `redesign-phases.md`'s backlog already tracks similar
  not-yet-generalized decisions (`Avatar` size token, `Pill` tone sizing).
- `Button` primitive: today's raw `<button>` elements in this file (former save button —
  removed; pin toggle; usage refresh; dialog Cancel/Create) migrate onto `Button`, closing out
  the `InfoPanel`-not-yet-migrated backlog item from `docs/frontend-components.md`.

## Edge Cases

1. **Title edit committed empty** — committing an empty title saves empty, same as today's
   behavior; only the entry interaction (click-to-edit vs. always-visible input) changes.
2. **Group list empty** (`groups.length === 0`) — dropdown shows only "None" / "+ Add Group…",
   unchanged from today.
3. **Usage section with no data** (`!usageQuerySupported && !(usage?.rate_limits ||
   usage?.cost)`) — entire Usage section hidden, same guard `InfoPanel.tsx:199` uses today.
4. **Usage supported but never refreshed** (`usageQuerySupported && !usage?.rate_limits`) —
   keeps today's "tap refresh" placeholder row.
5. **Very long workspace path / session ID** — unchanged `word-break: break-all` wrapping in
   the Session & Workspace section.
6. **Title edit: blur vs. Escape** — blur commits (matching the existing blur-commits pattern
   `QuickPhrasesRow`'s add-input already uses), `Escape` explicitly reverts without committing
   and exits edit mode.
7. **Title edit while another field is mid-edit** (e.g. Add-Group dialog open) — no
   cross-field interaction; both are independent local component state, can coexist without
   conflict (matches today's independent `titleDraft`/`newGroupName` state).

## Testing

- `InfoPanel.test.tsx`: restructured-section rendering (3 sections, correct order, Model/
  Auto-approve rows absent), click-to-edit title (click opens edit mode, `Tab`+`Enter` opens
  it, `Enter` commits, blur commits, `Escape` reverts without calling `onRename`), meter
  `role="progressbar"` with correct `aria-valuenow`, non-color warning glyph present at ≥80%,
  `Button`-migrated elements render with expected `aria-label`s.
- Run `cd frontend && npm run test:web`.

## Files to Modify

1. `frontend/src/components/InfoPanel.tsx` — restructure into 3 sections in new order,
   click-to-edit title, drop `onModelChange`/`onAutoApproveToggle` props and their rows,
   `Button` migration.
2. `frontend/src/components/InfoPanel.module.css` — remove card chrome, add hairline dividers,
   meter styles, typographic hierarchy, warning glyph, token cleanup.
3. `frontend/src/components/InfoPanel.test.tsx` — update for restructured sections and new
   click-to-edit interaction; add meter/accessibility coverage.
4. `frontend/src/components/ChatPanel.tsx` — stop passing `onModelChange`/`onAutoApproveToggle`
   to `<InfoPanel>` (only the two props threaded into `InfoPanel` specifically; the header's
   Steer/Auto-approve buttons and the `onModelChange` handler itself are untouched here — they
   still exist in `ChatPanelInner` for Phase 4 to pick up). Required regardless of Phase 4's
   timing: `InfoPanelProps` dropping these two fields means TypeScript's excess-property check
   on the `<InfoPanel>` JSX call site fails to compile if `ChatPanel.tsx` still passes them,
   whether or not Phase 4 has shipped yet.
5. `docs/frontend-components.md` — update `Button` migration note (`InfoPanel` no longer
   listed as not-yet-migrated).
6. `docs/design/redesign-phases.md` — add this as a new phase entry once scoped/shipped.

### No changes needed

- `ChatState` / `UsageTotals` / any backend/API contract — presentational and prop-shape only.
- `Composer.tsx`, `QuickPhrasesRow.tsx`, `ChatPanel.tsx` header buttons — out of scope, covered
  by the separate Phase 4 spec.
