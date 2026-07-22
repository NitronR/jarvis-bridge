# Header/Toolbar Cleanup

## Overview

Regroup `ChatPanel.tsx`'s header row from 9 flat, identical buttons into a primary/secondary
layout with visual hierarchy, migrate buttons onto the existing `Button` primitive, and
replace the cryptic "AA✓" auto-approve label with a self-explanatory toggle. This is a
presentational change only — no changes to chat state types, data flow, or backend APIs.

**Driver**: the header toolbar was flagged as a real pain point during Phase 2's discovery
stage (9 flat buttons with no grouping, cryptic "AA✓" label) but explicitly deferred to its
own spec rather than bundled in the transcript redesign.

**Non-goals** (explicitly out of scope for this spec):
- Composer and Info panel — not raised as pain points, left untouched.
- New token layers — this design works entirely within existing `Button` primitive tokens and
  the spacing/type scale; no new CSS custom properties are introduced.
- Icon library adoption — unicode symbols are used for the primary group icons;引入 a
  dependency (e.g. lucide-react, heroicons) is not justified for 3 icons.
- Dropdown/overflow menu for secondary actions — secondary buttons remain visible in the
  header row; hiding them behind a click adds complexity without clear benefit for 5 buttons.

**Dependency**: builds on the design-system spec
(`docs/superpowers/specs/2026-07-21-design-system-design.md`) — the `Button` primitive it
defines must exist in `frontend/src/components/ui/` before this spec's implementation starts.
This is the first call site to adopt `Button`, clearing the Phase 2 backlog item ("Button has
zero call sites migrated").

## Current State

`ChatPanel.tsx`'s header (lines 409–438) renders 9 raw `<button>` elements in a flat flex
row:

| Button | Action | State |
|--------|--------|-------|
| Info | Toggles info panel visibility | Always enabled |
| Follow | Toggles auto-scroll to latest | Toggle (accent when on) |
| Chats | Opens past chats drawer | Always enabled |
| + New | Starts new chat session | Always enabled |
| + New in... | Opens workspace picker for new chat | Disabled when `!customWorkingDirectory` or `pickingFolder` |
| Fork | Forks current session | Disabled when `!canFork` or `busy` |
| Steer | Enables steer mode in Composer | Toggle; disabled when `!steer` capability |
| AA | Abbreviation for auto-approve | Disabled when `!toolApprovals` |
| AA✓ | Abbreviation for auto-approve (on state) | Disabled when `!toolApprovals` |

Problems:
1. No visual grouping — all 9 buttons look identical, no hierarchy.
2. Cryptic "AA✓" label — requires prior knowledge of the abbreviation.
3. Raw `<button>` elements instead of the `Button` primitive (backlog item from Phase 2).
4. No icons — all actions are text-only, no visual differentiation.

## Design

### Button grouping

The 9 buttons split into two groups separated by a 1px vertical divider:

**Primary group** (left of divider, 3 buttons):
- `＋ New` — starts a new chat session
- `↓ Follow` — toggles auto-scroll
- `☰ Chats` — opens past chats drawer

**Secondary group** (right of divider, 5 buttons):
- `ℹ Info` — toggles info panel
- `＋ New in...` — opens workspace picker
- `⑂ Fork` — forks current session
- `↗ Steer` — toggles steer mode
- `Auto-approve` — toggles auto-approve

Layout remains a single flex row inside the existing `.header` container (44px height,
`--color-surface-1` background, bottom border). The `<h1>` title stays left-aligned with
`flex: 1` for overflow ellipsis. Primary buttons sit right after the title, divider, then
secondary buttons. No structural changes to the header container — just regrouping children
and inserting a divider `<span>`.

### Button variants and styling

All buttons migrate from raw `<button>` to `Button` primitive
(`frontend/src/components/ui/Button.tsx`):

- **Primary buttons** (`＋ New`, `↓ Follow` when active, `☰ Chats`):
  `variant="primary"` — accent background (`--button-primary-bg`), accent border
  (`--button-primary-border`), dark foreground (`--button-primary-fg`). Hover uses
  `--button-primary-bg-hover`.

- **Secondary buttons** (`ℹ Info`, `＋ New in...`, `⑂ Fork`, `↗ Steer`, `Auto-approve` off):
  default variant — transparent background, `--color-border` border. Hover:
  `--color-surface-1` background, `--color-border-strong` border.

- **Active toggles** (`↓ Follow` on, `↗ Steer` on): switch to `variant="primary"` to
  signal active state.

- **Auto-approve on**: `variant="primary"` with a `✓` icon before the label.

- **Disabled state**: existing `Button` disabled styling (opacity 0.5, `cursor: not-allowed`).

All buttons keep `padding: var(--space-2) var(--space-5)` and `font-size: var(--font-size-3)`
(12px) — matching the current header button sizing. Unicode icons sit before the label text,
separated by `gap: var(--space-2)`.

### Unicode icons

Primary buttons get unicode symbols:

| Button | Icon | Unicode | Rationale |
|--------|------|---------|-----------|
| `＋ New` | ＋ | U+FF0B | Full-width plus, visually heavier than ASCII `+` |
| `↓ Follow` | ↓ | U+2193 | Down arrow, signals "scroll to bottom" |
| `☰ Chats` | ☰ | U+2630 | Trigram for heaven, universally reads as "menu/list" |

Secondary buttons stay text-only. The `✓` icon appears only on the auto-approve button when
toggled on (before the "Auto-approve" label).

These common unicode symbols render consistently across platforms in the existing system font
stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).

### Auto-approve toggle

The auto-approve button replaces the current "AA"/"AA✓" with a full-word toggle:

- **Off**: Default `Button` variant. Label: "Auto-approve". No icon.
- **On**: `variant="primary"`. Label: "Auto-approve". `✓` icon before label.
- Click toggles `chat.setAutoApprove(!current)`. Disabled when
  `!ctx.state.capabilities.toolApprovals`.

The button is slightly wider than other secondary buttons due to the full label — acceptable
since it sits in the secondary group where there's room. The existing `onAutoApproveToggle`
callback (line 291) is reused; the header button and the InfoPanel toggle both call the same
handler.

### Divider

A 1px vertical separator between primary and secondary groups:

```css
.divider {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 var(--space-2);
  flex-shrink: 0;
}
```

Uses the existing `--color-border` token. `flex-shrink: 0` prevents it from collapsing when
the title squeezes.

### Tokens

**No new tokens.** The design works entirely within:
- Existing `Button` primitive tokens (`--button-primary-bg`, `--button-primary-border`,
  `--button-primary-fg`, `--button-primary-bg-hover`)
- Existing primitive tokens (`--color-border`, `--color-surface-1`, `--color-border-strong`,
  `--space-2`, `--space-5`, `--font-size-3`)
- Existing `tokens.css` spacing/type scale

The primary/secondary distinction comes from `Button`'s `variant` prop, not new CSS variables.
This is intentional — the header buttons aren't a unique enough pattern to justify their own
token layer.

### Files to modify

1. `frontend/src/components/ChatPanel.tsx` — regroup buttons, migrate to `Button` primitive,
   add divider element, rename "AA"/"AA✓" to "Auto-approve", add unicode icons to primary
   buttons.
2. `frontend/src/components/ChatPanel.module.css` — add `.divider` rule, remove or simplify
   `.header button` rule (button styling is now owned by `Button.module.css`).

### No changes needed

- `ChatPatch` / `MessageEntry` types — purely presentational.
- `tokens.css` — no new tokens.
- `Button.tsx` / `Button.module.css` — consumed as-is, no extensions needed.
- `Composer.tsx`, `InfoPanel.tsx`, `Transcript.tsx` — out of scope.

## Edge Cases

1. **All secondary buttons disabled** — when the backend has no capabilities, every secondary
   button renders disabled (opacity 0.5, no pointer events). The divider still renders. The
   header doesn't collapse or reflow.

2. **Auto-approve on + capabilities missing** — if `toolApprovals` is false, the auto-approve
   button is disabled regardless of its current on/off state. The user can't toggle it. This
   matches current behavior.

3. **Follow active + chat not following** — the `↓ Follow` button toggles between
   `variant="primary"` (following) and default (not following). The existing `followChat`
   state and localStorage persistence are unchanged.

4. **Steer enabled + busy** — the `↗ Steer` button is disabled when `chat.busy` is true (can't
   steer mid-turn), matching current behavior. When not busy and `capabilities.steer` is true,
   it toggles `steerEnabled` state and switches variant.

5. **"+ New in..." disabled** — renders disabled when
   `!ctx.state.capabilities?.customWorkingDirectory`. Stays disabled during folder picker
   operation (`pickingFolder` true).

6. **Very long session title** — the `<h1>` title has `flex: 1` with
   `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. Buttons never compress or
   wrap — the title absorbs the squeeze.

7. **Reduced motion** — no animations are introduced by this spec. The existing
   `@media (prefers-reduced-motion: reduce)` rule on `.infoWrap` is unaffected.

8. **Info panel hidden** — the header layout is independent of the info panel's visibility.
   Toggling Info (showing/hiding the panel) doesn't affect header button positioning.

## Testing

- Existing `ChatPanel` test assertions should keep passing — the header is rendered but not
  deeply asserted on in current tests (component tests focus on chat flow, not button layout).
- Add a new test (or extend existing): verify the header renders the correct number of buttons
  (9 total), the divider element exists, and auto-approve toggles its variant on click.
- Migrating raw `<button>` to `Button` primitive means `Button.test.tsx` already covers the
  primitive's behavior — no need to re-test button rendering in isolation.
- Run `cd frontend && npm run test:web`.
