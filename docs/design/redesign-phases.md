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

## Phase 4: Composer Redesign — Done (2026-07-22)

Scoped to `Composer` only — the Info Panel half of the original "Composer + Info Panel Audit"
entry remains deferred (not raised as a pain point, no audit run against it yet). Fixed the
critical accessibility bug (quick-phrases overflow, now a real keyboard/touch-operable
button), the four major issues (color-only context warning, no persistent send-mode
indicator, inconsistent empty-input handling, missing attach `aria-label`), and the minor
ones (raw `<button>`s in `Composer.tsx` migrated onto `Button`, hardcoded px values onto
tokens, auto-resizing textarea capped at ~4 lines). Relocated Steer and Auto-approve out of
`ChatPanel`'s header, and the model selector out of `InfoPanel`, into one consolidated
turn-controls action row in the Composer.

- Spec: `docs/superpowers/specs/2026-07-22-composer-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-07-22-composer-redesign.md`

## Phase 5: Info Panel Redesign — Done (2026-07-23)

Restructured `InfoPanel.tsx` from four uniform bordered cards into three typographic
sections (Chat identity → Usage → Session & workspace, merging the old Overview/Session
split), added click-to-edit title, per-window usage meters with a non-color-only ≥80%
warning signal, and migrated its raw `<button>` elements onto the `Button` primitive.
Assumes Phase 4's removal of the Model selector/Auto-approve toggle from this file has
already landed here (done as part of this phase, ahead of Phase 4 itself, to avoid a
compile break — see the spec's Files to Modify note on `ChatPanel.tsx`).

- Spec: `docs/superpowers/specs/2026-07-22-info-panel-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-07-22-info-panel-redesign.md`

### Phase 5b: Top Bar Redesign — Done (2026-07-23)

Moved session-specific controls (Title, Group, Pin) from InfoPanel into the ChatPanel
header bar. Title became click-to-edit with an underline+border affordance, Group uses the
`Select` primitive (same as model picker in Composer), Pin is an icon button left of
Settings. Removed the now-empty "Current chat" section from InfoPanel, removed the Slash
cmds row, and reordered remaining sections (Session & workspace → Usage). InfoPanel is now
a slim two-section sidebar (Session & workspace + Usage).

- Spec: `docs/superpowers/specs/2026-07-22-topbar-redesign.md`

## Phase 6: Chats & Groups Popup Redesign — Not started

`ChatsDrawer.tsx` (the "Chats" popup reached from `ChatPanel`'s header) currently mixes a
raw `<select>`-based workspace/backend filter row, a tab bar (`Chats` / `Groups`) built from
scratch, session cards with inline pin/delete actions, and a `Groups` tab as a collapsible
accordion. None of it uses `Button`, `Select`, or `Pill` — it predates all three primitives.

Candidate pain points to confirm in audit (stage 2) before writing a spec:
- Two raw `<select>` filters (`aria-label="Workspace"`, `aria-label="Backend"`) — candidates
  for the new `Select` primitive (`frontend/src/components/ui/Select.tsx`, built during the
  Composer redesign but not yet documented in `docs/frontend-components.md` or adopted
  anywhere).
- Tab bar, close button, pin/delete/pin-toggle buttons are all raw `<button>` — candidates
  for `Button`.
- Groups tab: empty state is a single line ("No groups yet."); no way to create a group from
  here (group creation lives in `InfoPanel`'s "+ Add Group…" dialog per `AGENTS.md`) — worth
  checking whether that's a real pain point or intentional separation of concerns.
- Search only matches session ID substrings, not titles — may or may not be in scope.

Non-goals to confirm in spec: changing where groups are created/assigned (`InfoPanel`),
changing the underlying `groups` API contract.

## Phase 7: Settings Dialog Redesign — Not started

`SettingsDialog.tsx` currently holds two sections: "Default agent backend" (a raw `<select>`)
and "Quick phrases" (add/remove list, duplicating state already editable directly in
`Composer.tsx`/`QuickPhrasesRow` via the same `loadQuickPhrases`/`saveQuickPhrases` module).

Decided scope (carry into the spec):
- **Remove the Quick Phrases section from Settings entirely.** Confirmed redundant: Composer
  already has its own add/remove UI for the same `localStorage`-backed list
  (`frontend/src/state/quickPhrases.ts`); Settings never was the only place to manage it.
- Redesign the remaining "Default agent backend" section — migrate its raw `<select>` onto
  the `Select` primitive, its close button onto `Button`, and audit the modal chrome
  (backdrop/header/body) for consistency with other dialogs (`ApprovalModal`,
  `ElicitationModal`).
- Confirm whether any other settings belong here now that Quick Phrases is gone, or whether
  a single-section dialog is fine as-is (a legitimate outcome, not necessarily a problem to
  solve by adding content).

Non-goal to confirm in spec: don't expand Settings' scope with new preferences not already
requested elsewhere.

## Phase 8: Workspaces ("New in…") Popup Redesign + Bookmarking — Not started

`WorkspacesDrawer.tsx` is currently minimal: a header, an "Open folder…" button, and a flat
recency-ordered list of `recentWorkspaces` (basename + full path), sourced entirely from
`frontend/src/state/recentWorkspaces.ts` (a `localStorage`-backed MRU list, no backend
persistence, no dedup beyond exact-path match).

Decided scope:
- Redesign the popup itself (visual/interaction pass — audit first for concrete pain points,
  e.g. no distinction between the just-opened workspace and older ones, no search/filter for
  users with many workspaces).
- **Add workspace bookmarking**: a way to bookmark/unbookmark a workspace from this popup,
  and a bookmarked-workspaces section (or tab, to be decided in the spec) shown alongside
  recents.

Open questions for the spec/brainstorm stage (don't decide here):
- Storage: mirror `recentWorkspaces.ts`'s `localStorage` pattern with a new
  `bookmarkedWorkspaces.ts` (simplest, consistent with current no-backend-persistence
  design), vs. promoting to backend persistence (`session_metadata.json` already persists
  other cross-session state per `AGENTS.md` — but bookmarks aren't session-scoped, so this
  would be a new top-level concept, not a fit for the existing per-session store as-is).
- Interaction model: bookmarked and recent as separate list sections in one view, vs. a
  tab bar like `ChatsDrawer`'s Chats/Groups split (Phase 5 above) — worth deciding once,
  consistently, if both drawers end up with a similar two-list shape.
- What happens when a bookmarked workspace no longer appears in recents (never removed vs.
  auto-pruned) — an edge case the spec must enumerate per `docs/design/philosophy.md`.

## Phase 9: Design System Consistency Review — Not started

Not a visual redesign — an audit-and-migrate pass checking the app against
`docs/frontend-components.md`'s inventory and `docs/design/philosophy.md`'s token/primitive
discipline, closing gaps left by incremental adoption across Phases 1–7.

Known gaps found in a quick audit (to confirm/expand during the audit stage):
- **`Select` primitive now documented and adopted (Composer + ChatPanel header).** Exists at
  `frontend/src/components/ui/Select.tsx` (accessible custom select: keyboard nav, listbox
  semantics, top/bottom auto-placement), now in `docs/frontend-components.md`'s primitives
  list, and adopted by `Composer`'s model selector (Phase 4) and `ChatPanel`'s group
  selector (Phase 5b). Raw `<select>` elements remain in `SettingsPanel.tsx` (see
  dead-code note below), `SettingsDialog.tsx`, and `ChatsDrawer.tsx` — candidates once
  Phases 6–7 land.
- **`Button` adoption gap**, beyond the already-tracked `InfoPanel` backlog item: raw
  `<button>` elements also remain in `ApprovalModal.tsx`, `ElicitationModal.tsx`,
  `TerminalDrawer.tsx`, `ChatsDrawer.tsx`, and `WorkspacesDrawer.tsx`.
- **Two dead components found**, superseded by later redesigns but never removed:
  `PastChatsMenu.tsx` (+ its `.test.tsx`) — superseded by `ChatsDrawer.tsx`, zero non-test
  importers — and `SettingsPanel.tsx` — superseded by `SettingsDialog.tsx`, zero importers.
  Confirm with the user and delete rather than carry forward as redesign scope.
- **Fold in the still-open Phase 1/2 backlog items** (below) as part of this pass rather than
  leaving them as a separate perpetual list, since this phase's whole purpose is closing
  exactly this kind of drift.
- **`prefers-reduced-motion` gap:** Add `@media (prefers-reduced-motion: reduce)` rules to
  ChatsDrawer and WorkspacesDrawer (`slideIn` keyframe animations), `Dot` spin, and InfoPanel
  refresh icon spin. For status spinners, replace the animation with a non-motion indicator
  (static icon + `aria-live` text update) rather than simply removing the animation — a static
  spinner is visually identical to an idle state and loses all meaning. See
  `docs/design/philosophy.md`'s Motion & Animation section for the full handling guidance.

Non-goal: this phase should not introduce new primitives or tokens — it migrates existing
call sites onto what already exists, per philosophy.md's "only tokenize what actually
repeats."

## Backlog: Deferred Findings (non-blocking)

Minor findings surfaced during Phase 1/2 review, explicitly deferred rather than fixed.
To be resolved as part of Phase 9 (Design System Consistency Review) rather than as a
standalone pass — kept listed here until then so they aren't lost to chat history.

- **`Button` call sites: `ChatPanel` migrated (Phase 3), `Composer` migrated (Phase 4),
  `InfoPanel` migrated (Phase 5).** Remaining raw `<button>` elements in
  `ApprovalModal.tsx`, `ElicitationModal.tsx`, `TerminalDrawer.tsx`, `ChatsDrawer.tsx`,
  and `WorkspacesDrawer.tsx` — candidates for Phase 9.
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
