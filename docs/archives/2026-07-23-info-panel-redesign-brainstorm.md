# 2026-07-23 — Info Panel Redesign: Brainstorm, Spec & Plan

## Summary

Adopted the senior-ui-ux-designer persona, read the frontend design context docs
(`docs/design/philosophy.md`, `docs/guidelines/ui-ux-process.md`,
`docs/design/redesign-phases.md`), then ran a full `superpowers:brainstorming` session on
the Info Panel redesign (driven by the user's complaint that it "feels flat and dull"),
producing a written spec and implementation plan.

This session did **not** implement any code — it produced planning artifacts only. A
concurrent session executed the resulting plan in full, then went further with a follow-up
redesign (see Superseded By, below).

## What was produced

- Spec: `docs/superpowers/specs/2026-07-22-info-panel-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-07-22-info-panel-redesign.md` (7 tasks)

Both committed during this session (commits `a514796`, `51075b1`).

## Key decisions (via visual companion + one-at-a-time questions)

- **Driver**: no prior heuristic audit existed for `InfoPanel` (explicitly deferred by the
  Composer redesign spec) — this round was prompted directly by user complaint, grounded in
  a quick informal pass (uniform card weight, no icons/accents, color-only usage warning)
  before proposing visual directions.
- **Scope**: restyle *and* restructure (user opted into reconsidering grouping/hierarchy, not
  just visual polish).
- **Composer dependency**: designed `InfoPanel` as if Phase 4 (Composer redesign — separate,
  not-yet-implemented spec) had already removed the Model selector and Auto-approve toggle,
  since the user confirmed that removal was a near-term certainty.
- **Visual direction**: presented 3 mocked-up directions via the brainstorming skill's visual
  companion (browser-based mockups) — A) Elevated Stat Panel (colored left-accent cards +
  icons), B) De-carded Typographic (no card chrome, hairline dividers, whitespace-driven), C)
  Dashboard Tiles (2-column KPI grid). **User selected B.**
- **Hierarchy**: user chose "keep everything perfectly even" (no extra visual weight for
  Usage despite it being a top reason to open the panel) — hierarchy comes from **section
  order only**: Chat identity → Usage → Session & workspace.
- **Structure**: merged the old "Overview" and "Session" cards into one "Session &
  workspace" section (user's own mental grouping).
- **Interaction**: title becomes click-to-edit (static text + pencil affordance, keyboard
  operable) replacing the always-visible input + save button.
- **Accessibility**: fixed the color-only ≥80% usage warning with a `⚠` glyph + bold weight
  (same fix class as the Composer spec's context-warning fix); added `role="progressbar"`
  meters for rate-limit rows.
- **No new `ui/` primitive** for the usage meter (one consumer today — YAGNI, revisit if a
  second consumer appears).

## Self-review catches (during spec + plan writing)

- Spec: originally said `ChatPanel.tsx` needed no changes, reasoning the separate Composer
  spec would handle removing `onModelChange`/`onAutoApproveToggle` props from the
  `<InfoPanel>` call site. Caught that this breaks if the Info Panel spec ships *before*
  Composer's Phase 4 (likely, since Phase 4 wasn't implemented yet) — TypeScript's
  excess-property check on JSX would fail to compile. Fixed by adding a one-line prop-removal
  edit to `ChatPanel.tsx` as part of this spec, independent of Phase 4's timing.
- Plan: caught two gaps against the spec during self-review — (1) forgot to remove the Pin
  toggle's bordered-button chrome (spec called this out explicitly), (2) missing a test for
  the "commit empty title" edge case. Both fixed inline before presenting the plan.

## Superseded by concurrent work

While this session was still in the brainstorming/spec/plan phase, a **different, concurrent
session** on the same working directory:

1. Executed this plan in full (commits `ffbff8a` through `3456554` — drop Auto-approve
   toggle, reorder/merge sections, click-to-edit title, usage meters + warning signal, card
   chrome removal, Button migration, phase-done doc update).
2. Went further with an unplanned **Phase 5b: Top Bar Redesign** (see
   `docs/archives/2026-07-23-topbar-redesign-session.md`) — moved Title, Group, and Pin
   *out of `InfoPanel` entirely* into `ChatPanel`'s header bar, and removed the "Slash cmds"
   row. This means the "Chat identity" section this spec designed no longer exists in
   `InfoPanel` as shipped; current `InfoPanel.tsx` (as of commit `e01b07d`) only has Usage
   and Session & workspace.

The spec and plan from this session remain accurate as a historical record of the reasoning
behind the visual language (hairline dividers, typographic hierarchy, non-color warning
signal, meters) — that part shipped as designed. The Content Structure & Order section's
3-section layout is superseded; readers should treat `docs/design/redesign-phases.md`'s
Phase 5b entry and the topbar-redesign archive as the current source of truth for what
`InfoPanel` actually contains today.

## Follow-up / next steps

- No action needed on this session's spec/plan files — they're historical record, not to be
  edited after the fact (per this repo's archive convention).
- If anyone re-reads `docs/superpowers/specs/2026-07-22-info-panel-redesign-design.md` later
  expecting it to match current `InfoPanel.tsx`, point them here first.
