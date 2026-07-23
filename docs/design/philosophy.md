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

**What this product is, UX-wise:** jarvis_bridge is a developer-facing, information-dense,
streaming-state tool — a multi-pane layout (sidebar + chat + terminal drawer) with
real-time tool-call streams, status indicators, and configuration surfaces that expose
real power (multi-backend selection, model pinning, auto-approve) without overwhelming a
first-run user. Every design decision should be filtered through this: we are not building
a consumer app, and information density, streaming state, and developer workflow efficiency
are the primary UX constraints.

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
5. **Motion must communicate, not decorate.** No animation "because it looks nice." Every
   animation must map to a category in the Motion & Animation section below (state
   indication, affordance feedback, or entrance/exit). If you can't name which category it
   belongs to and why the user needs it, don't add it.
6. **The next action must always be obvious.** Navigation, task flows, and content hierarchy
   should be structured so the user never has to wonder "what do I do next?" — see
   Interaction Pattern Principles below.
7. **Every interactive state is a design surface.** Loading, empty, error, success, and
   partial/streaming states are first-class, not afterthoughts bolted on post-implementation.
   See State Design below.

## Interaction Pattern Principles

How to choose between modal, inline, and drawer patterns — the interaction vocabulary this
repo uses:

- **Drawer (side panel)** for content that supplements the current view without replacing it.
  The terminal drawer and Info panel are the canonical examples: they preserve chat context
  while exposing additional information. Drawers must support keyboard dismiss (Escape) and
  announce their presence to screen readers.
- **Inline** for content that belongs in the current flow. Quick phrases, model selection,
  and auto-approve toggles live inline in the Composer because they modify the current
  message being composed — pulling them into a modal would break the user's train of thought.
- **Modal** for destructive or irreversible actions that need focused attention (approval
  dialogs, delete confirmations). Modals must trap focus, support Escape-to-close, and
  return focus to the triggering element on dismiss. Never use a modal for content that
  could be inline — a modal is a tax on the user's attention.
- **Popup/dropdown** for transient selections that don't need their own panel (backend
  picker, workspace list). Popups must close on Escape and outside click, and the trigger
  element must be focusable.
- **When uncertain, prefer the least disruptive pattern** that still gives the user full
   context. Default to inline over modal, drawer over full-screen takeover.

## State Design

Every interactive component must be designed for all of its states, not just the happy path.
Treat state transitions as part of the visual design, not a technical implementation detail.

- **Empty state**: must explain *what goes here* and *how to populate it*, not just say "No
  data." The ChatsDrawer's "No groups yet." is a minimal example; a better version would
  link to where groups can be created.
- **Loading/skeleton state**: for async content, show a skeleton or placeholder that
  communicates the *shape* of what's coming, not a generic spinner. Skeletons preserve
  layout stability and reduce perceived wait time.
- **Error state**: must tell the user *what failed*, *why it might have failed*, and *what
  they can do about it*. "Something went wrong" is never an acceptable error message.
- **Streaming/partial state**: jarvis_bridge's core interaction is streaming chat responses
  and tool-call status updates. These must be designed for: content changes without user
  action, new elements appear as they stream in, and existing elements may update in place.
  The transcript redesign's approach (avatar grouping, Dot status indicators, timeline
  separators) is the baseline for how streaming state is rendered.
- **Boundary states**: first item in a list, last item, a run of many same-type items —
  these get explicit treatment in every design spec's edge-case section (see Process
  Commitments). The visual treatment of "three consecutive assistant messages" must be
  designed, not left to the browser's default stacking.

## Progressive Disclosure

jarvis_bridge exposes real configuration power (multi-backend selection, model pinning,
auto-approve, workspace management) — but a first-time user should never feel overwhelmed.

- **Default to the simplest path.** A new user should be able to send a message without
  touching any settings. Backend selection, model pinning, and auto-approve are power-user
  features that are accessible contextually (in the Composer, at the moment of sending) rather
  than surfaced by default in the main chrome or a separate settings screen.
- **Group related settings by user intent, not by system architecture.** Settings that
  affect the same user task (e.g., "how does my message get sent" — backend, model,
  auto-approve) should be co-located, even if they touch different backend systems.
- **Surface advanced features contextually, not globally.** The model selector lives in
  the Composer (where you're about to send a message) because that's when model selection
  is relevant — not in a top-level Settings page the user has to navigate to separately.

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

## Signal Vocabulary

The visual language this repo uses to communicate state. Every new component must use these
existing signals, not invent new ones:

- **Button hierarchy**: `primary` (filled, one per context), `default` (outlined, for
  secondary actions), `danger` (red, for irreversible actions). One primary button per view;
  if there are two equal-weight actions, neither should be primary. Ghost (text-only,
  low emphasis) is a planned Phase 9 primitive — not yet implemented.
- **Status indicators**: color + icon + text, never color alone. The `Dot` primitive
  (`frontend/src/components/ui/Dot.tsx`) is the canonical example — callers must pair it
  with an adjacent text label or pass an explicit `aria-label` prop. A bare `<Dot>` with
  no adjacent text and no `aria-label` is an accessibility violation, even though the
  component itself does not enforce this. Example correct usage:
  `<Dot status={s} aria-label={statusLabel[s]} />` with a `statusLabel` map (ok, bad,
  progress, idle). A colored border or background without an icon or label is not an
  accessible status signal.
- **Motion as meaning**: spinner = in progress, slide-in = panel appearing, opacity fade =
  content loading. These are defined in the Motion & Animation section below — don't
  introduce new motion semantics without adding them there first.
- **Warning/over-limit signals**: ≥80% context usage gets a non-color-only indicator (see
  InfoPanel's usage meters — color + icon, not just a yellow bar). This pattern should be
  reused wherever a threshold needs to communicate urgency.

## Motion & Animation

All animation in this repo is CSS-only (transitions and `@keyframes`). No JS animation
libraries (framer-motion, react-spring, GSAP). This keeps the bundle small, makes
`prefers-reduced-motion` trivial to implement, and avoids runtime animation costs.

### Timing conventions

| Category | Duration | Easing | Example |
|----------|----------|--------|---------|
| Micro-interaction (hover, focus, active) | ≤150ms | `ease` | Button hover, Select focus ring, copy-button reveal |
| Panel entrance/exit | 150–200ms | `ease-out` | Drawer slide-in, info panel width |
| Status indication (spin) | 0.8s | `linear`, infinite | Dot loading, refresh icon spin |

New animations must fit these ranges. If an animation feels sluggish, it's probably too
slow — reduce duration before changing easing. Avoid spring physics, ease-in-out, and
durations longer than 200ms for UI chrome (longer durations are for page-level transitions,
which this app doesn't have).

### Motion vocabulary (three tiers)

1. **State indication** (required, purposeful): communicates that the system is working.
   Spinners for in-progress operations. Must be paired with a text label or `aria-label`
   for screen readers — a spinning icon alone is not accessible.
2. **Affordance feedback** (expected, minimal): hover/focus transitions that confirm the
   element is interactive. These should be barely perceptible —120ms ease, no overshoot.
   Removing them makes the UI feel unresponsive; adding more makes it feel janky.
3. **Entrance/exit** (contextual): panel slide-ins, content fade-ins. Must respect
   `prefers-reduced-motion` — when the user has requested reduced motion, replace the
   animation with an instant state change (same final state, zero duration).

### `prefers-reduced-motion` handling

Every animation must be disabled or replaced when the user's OS requests reduced motion.
Currently only `ChatPanel.module.css` handles this (for the info panel width transition).

**For entrance/exit animations** (drawer slide-in, panel transitions): set duration to zero —
the final state is still correct, and instant appearance satisfies the reduced-motion request.

**For status spinners** (Dot spin, refresh icon spin): do not simply remove the animation,
or the result looks identical to an idle/paused state and loses all meaning. Instead,
replace with a non-motion indicator: a static icon with an `aria-live="polite"` text update,
or a pulsing opacity animation (which is still motion but at a greatly reduced frequency).
A static colored circle is not an acceptable replacement for a spinner under reduced-motion.

All future animations must include a `@media (prefers-reduced-motion: reduce)` rule. Existing
animations (ChatsDrawer/WorkspacesDrawer slide-in, Dot spin, InfoPanel spin) are a known gap —
close it during Phase 9 (Design System Consistency Review).

## Validation Methods

Design decisions should be validated continuously, not in a single big-bang study at the
end. Lightweight methods preferred:

- **Heuristic evaluation** (Nielsen's 10, adapted) as a fast pre-launch gate. Run it
  against the spec before implementation starts — it catches structural problems when
  they're still cheap to fix.
- **Five-second test** for first impressions: show the interface for five seconds, then ask
  "what is this, and what can you do with it?" If users can't answer, the information
  architecture needs work.
- **Task-based walkthroughs** for flow validation: give users a concrete task (e.g., "switch
  to a different backend and send a message") and watch where they hesitate. Hesitation
  points are signal — instrument those screens with analytics if the walkthrough isn't
  feasible.
- **Support tickets and bug reports as research artifacts.** Recurring confusion in issue
  trackers is often better signal than a formal usability study — it's real users hitting
  real friction at scale.
- **Instrumented analytics on drop-off points.** If a redesign changes a flow, measure
  completion rate before and after. A redesign that looks better but has lower task
  completion is a failed redesign.

## Performance as UX

Performance is a design decision, not just an engineering concern. Perceived performance
matters as much as actual performance — users form trust judgments in the first few seconds.

- **Streaming smoothness.** jarvis_bridge's core interaction is streaming chat responses.
  Jank, flicker, or layout shift during streaming directly erodes trust. Design for it:
  content should appear progressively without pushing existing content around unexpectedly.
- **Skeleton screens over spinners** for content areas *(Phase 9+ deliverable — no skeleton
  component exists yet).* A skeleton that matches the expected content shape communicates
  "here's what's coming" and reduces perceived wait time. A generic spinner communicates
  nothing about what the user is waiting for.
- **Optimistic UI where safe** *(Phase 9+ deliverable — not currently implemented).* If an
  action has a predictable outcome (e.g., sending a message — it will appear in the
  transcript), show the result immediately and reconcile with the server response in the
  background. Don't make the user wait for a round-trip to see their own action reflected.
- **Layout stability** *(Phase 9+ deliverable — architectural change required).* No Cumulative
  Layout Shift during streaming or loading. Reserves space for content that hasn't arrived
  yet using `aspect-ratio` or `min-height` — not conditional rendering that causes reflow.
  Currently no such mechanism exists for streaming content; requires upstream changes to how
  chat/message content is rendered, not just a CSS fix.

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
