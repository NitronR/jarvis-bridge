# Frontend Redesign Phases

Tracks the status of jarvis_bridge's frontend redesign effort across phases — what's done,
what's next, and the backlog of deferred findings that aren't blocking but shouldn't be
forgotten. Grounded in `docs/design/philosophy.md`'s values and
`docs/guidelines/ui-ux-process.md`'s stages; update this file as each phase starts/finishes
rather than letting status live only in chat history.

## Status Legend

- **Done** — implemented, reviewed, merged.
- **Not started** — identified as a phase, no spec written yet.
- **Backlog** — a deferred finding from a completed phase's review; non-blocking, revisit
  opportunistically rather than as its own phase.

## Phase 1: Design System Foundations — Done (2026-07-21)

Token layering (spacing/type scale, component-layer tokens) plus four shared primitives:
`Dot`, `Avatar`, `Button`, `Pill` in `frontend/src/components/ui/`.

- Spec: `docs/superpowers/specs/2026-07-21-design-system-design.md`
- Plan: `docs/superpowers/plans/2026-07-21-design-system.md`
- Reference: `docs/frontend-components.md`

## Phase 2: Transcript Redesign — Done (2026-07-21)

Avatar-based visual style for `Message`/`Timeline`/`Transcript` — avatars with
consecutive-same-role grouping, double-box removal, `Dot`-based tool-call status pills.

- Spec: `docs/superpowers/specs/2026-07-21-transcript-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-07-21-transcript-redesign.md`
- Archive: `docs/archives/2026-07-21-design-system-transcript-redesign.md`

## Phase 3: Header/Toolbar Cleanup — Done (2026-07-21)

Regrouped `ChatPanel.tsx`'s header from 8 flat buttons into primary/secondary groups with a
divider, migrated onto `Button` primitive, replaced cryptic "AA✓" with self-explanatory
"Auto-approve" toggle. Unicode icons on primary buttons (＋, ↓, ☰).

- Spec: `docs/superpowers/specs/2026-07-21-header-toolbar-cleanup-design.md`
- Plan: `docs/superpowers/plans/2026-07-21-header-toolbar-cleanup.md`

## Phase 4: Composer + Info Panel Audit — Not started

Neither surface was raised as a pain point during Phase 2's discovery, so neither was
touched — but neither has had a heuristic audit run against it either (`ui-ux-process.md`
stage 2). Before any visual changes here, run that audit rather than assuming what needs
fixing.

## Backlog: Deferred Findings (non-blocking)

Minor findings surfaced during Phase 1/2 review, explicitly deferred rather than fixed.
Revisit opportunistically — when a listed file is next touched for another reason, or when
one of these visibly matters (e.g., a new `Pill` tone is added).

- **`Button` call sites: `ChatPanel` migrated (Phase 3); `InfoPanel` and `Composer` still
  use raw `<button>` elements.** Migrate onto `Button` whenever one of those files is next
  touched, rather than as a standalone migration pass.
- **`Pill`'s `.neutral` tone is ~2px larger than other tones** — it has a border the other
  tones don't (`Pill.module.css`, added during Phase 1's Task 5 fix), no `box-sizing` offset.
  No visible effect today since `Timeline` only ever renders `tone="neutral"`; would matter
  if another tone is used somewhere that sits adjacent to a neutral pill.
- **`Avatar`'s 28px size is a duplicated magic number** in `Avatar.module.css` and
  `Message.module.css`'s `.avatarSpacer` — no shared token. Worth a token
  (`--avatar-size` or similar) if a second consumer of that size ever appears.
- **`Avatar`'s `aria-label` is overridable via `{...rest}` spread order** in `Avatar.tsx` —
  a caller passing its own `aria-label` would silently override the role-derived one. Not
  exploited anywhere today; fix by reordering the spread if it ever causes a real bug.
- **`Message.tsx` references `styles.assistant`, a CSS class never defined** in
  `Message.module.css`. Confirmed pre-existing (present before Phase 2's branch started),
  not introduced by the redesign. Harmless (no-op class) but worth deleting or defining
  next time `Message.module.css` is touched.
- **`Timeline`'s `.thought` text shrank 14px→12px and lost its border/padding** as part of
  Phase 2 Task 3's restyle. Within that task's stated scope, not a separate regression, but
  noted here in case it reads as too subtle in practice.

## How to Use This Doc

- Starting a phase: change its status to "In progress," link the spec once written.
- Finishing a phase: mark "Done" with the date, link the spec/plan/archive note. If the
  phase produced a durable principle (not phase-specific detail), fold that into
  `docs/design/philosophy.md` instead of leaving it only here.
- Backlog items: promote to their own phase (or a task) when someone decides to act on one;
  until then, leave it listed here rather than letting it disappear into old chat history.
