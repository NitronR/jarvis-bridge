# Frontend Design Philosophy

This is the durable set of principles jarvis_bridge's frontend work is rooted in — distilled
from the senior-ux-designer persona, `docs/guidelines/ui-ux-process.md`, and the concrete
precedent set by the design-system + transcript-redesign work (2026-07-21). It exists so the
*next* redesign (header/toolbar cleanup, Composer, Info panel, or anything not yet built)
starts from the same values instead of re-deriving them, and so "why does this repo do X"
has one place to point to.

**Relationship to other docs:** `docs/guidelines/ui-ux-process.md` is the *process* — the
9 stages and when to use them. This file is the *values* those stages serve, plus the
house rules we've already learned by applying them once. `docs/frontend-components.md` is
the *inventory* — what primitives and tokens exist today. Read this file for "why we'd do
it this way," the process doc for "what stage am I in," and the components doc for "what's
already built."

## Core Values

In priority order, taken directly from the senior-ux-designer persona:

1. **User needs > stakeholder preferences > developer convenience.** When these conflict,
   user needs win. "Easier to implement" is a tiebreaker, never a deciding vote.
2. **The simplest solution that solves the real problem** — not the cleverest one. If a UX
   problem can be solved by removing something rather than redesigning it, say so before
   proposing new UI.
3. **Every pixel is a decision with a reason.** No "make it look nicer" without a specific,
   named change (a token, a spacing value, a contrast ratio). If you can't name the reason,
   don't make the change yet.
4. **Accessibility is not a pass at the end.** Contrast, keyboard nav, screen-reader labels,
   and never relying on color alone to convey state are load-bearing requirements, not
   polish — the transcript redesign's `Dot` status indicator exists precisely because a
   colored border alone isn't an accessible signal.
5. **Motion and decoration must have a purpose.** No animation "because it looks nice," no
   visual flourish added without a reason a user would notice its absence.

## Process Commitments

Concrete commitments this repo has made about *how* redesign work happens, not just what it
should look like:

- **Audit before polish.** The most common failure mode named in
  `docs/guidelines/ui-ux-process.md` is jumping straight to visual polish (its stage 6)
  without first auditing the current UI (stage 2) and checking the information architecture
  (stage 5). A redesign that skips straight to new colors and spacing produces something
  prettier but still structurally confusing. Every redesign spec should be able to point to
  a concrete pain point it's responding to — the transcript redesign named three specific
  heuristic findings (no visual anchors, double-box clutter, indistinct bubble types) before
  any visual direction was chosen.
- **Redesigns go through brainstorming, then a written spec, then plannotator review before
  implementation.** No frontend redesign skips straight to code. The spec is where scope,
  non-goals, and edge cases get pinned down while they're still cheap to change.
- **Name non-goals explicitly, in the spec, up front.** The transcript redesign spec called
  out "header/toolbar cleanup" and "Composer and Info panel" as out of scope, deferring the
  former to its own follow-up spec rather than letting scope grow mid-implementation. Every
  redesign spec should have a Non-goals section, not just a Goals section.
- **Presentational changes stay presentational.** A visual redesign should not need to touch
  data/state types (`ChatPatch`, `MessageEntry`, or their equivalents in future features)
  unless the spec explicitly says so. If a "just visual" change turns out to require a type
  change, that's a signal the spec's scope was wrong, not a green light to expand it
  silently.
- **Enumerate edge cases in the spec, not during implementation.** Empty states, error
  states, in-progress/loading states, and "what happens at the boundary" (first item in a
  list, last item, a run of many same-type items) get their own section in every design spec
  — see the transcript redesign spec's Edge Cases section as the template. A spec without
  an edge-case list is not done.

## Design System Discipline

- **Three-tier token layering, always**: primitive (raw values) → semantic/tint
  (usage-specific, e.g. `--color-danger-tint`) → component-layer (per-consumer, e.g.
  `--dot-ok`, `--pill-neutral-fg`). This is what lets a future theme change happen in one
  file instead of a find-and-replace across every component. Component CSS should reference
  only its own component-layer tokens plus the primitive spacing/type scale — never a raw
  hex or pixel value. `frontend/src/styles/tokens.test.ts` pins every token; extend it,
  don't work around it.
- **Only tokenize what actually repeats.** Audit existing CSS for the values already in use
  before inventing new tokens — this is how `--radius-bubble` was added as a single new
  component-layer token for the transcript redesign rather than a wholesale token rewrite.
- **Reuse primitives; don't re-inline their markup.** The transcript redesign consumed
  `Avatar` and `Dot` from `frontend/src/components/ui/` rather than redrawing initials or
  status circles inline in `Message.tsx`/`Timeline.tsx`. If a new redesign needs something
  an existing primitive almost does, extend the primitive — don't fork it.
- **Incremental adoption is allowed, but must be documented.** Not every consumer of a
  pattern has to migrate the same day a primitive is created (see `docs/frontend-components.md`'s
  note that `Button` has zero call sites migrated yet, and `QuickPhrasesRow` was deliberately
  left on token-only migration rather than moved onto `Pill`). The rule: when a migration is
  deferred, say so and say why, in the spec or the component doc — don't leave it to be
  discovered as an inconsistency later.

## What We Push Back On

Directly from the senior-ux-designer persona, applied to this repo:

- Adding visual flourish or animation with no purpose beyond "looks nice."
- Designing for the happy path only — every spec must answer "what does the empty state look
  like? What if the request fails? What if there are zero, one, or many items?"
- Complexity that exists to make an org-chart boundary visible in the UI rather than to serve
  the user (e.g., a settings surface split across screens because two teams own different
  parts of it, not because users think about it that way).
- Vague briefs. If the pain point isn't concrete and specific, ask until it is before
  proposing a visual direction.
- Silent scope creep in "presentational" work — see Process Commitments above.
