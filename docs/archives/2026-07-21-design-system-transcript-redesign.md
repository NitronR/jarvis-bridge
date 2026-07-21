# Design System + Transcript Redesign

**Date:** 2026-07-21
**Session ID:** aecd801d-255d-46c5-9aa1-1df58091c2b2

## Summary

Redesigned the chat Transcript (Message/Timeline/Transcript components) to a warm,
avatar-based visual style, preceded by a new shared design-system layer (spacing/type
token scale + `Dot`/`Avatar`/`Button`/`Pill` primitives) that the redesign depends on. Work
went through the full `brainstorming` → `writing-plans` → `subagent-driven-development`
pipeline: two approved specs
(`docs/superpowers/specs/2026-07-21-design-system-design.md`,
`docs/superpowers/specs/2026-07-21-transcript-redesign-design.md`), two TDD plans
(`docs/superpowers/plans/2026-07-21-design-system.md`,
`docs/superpowers/plans/2026-07-21-transcript-redesign.md`), 10 tasks total, each with a
fresh implementer subagent + task-scoped reviewer, plus a final whole-branch review.

Visual direction (chosen via a visual-companion mockup comparison): avatars, rounded
bubbles, generous spacing, over a "dense dev-tool" or "hybrid scannable" alternative.
User-driven refinement after seeing the mockup: consecutive same-role messages (both
roles, not just assistant) show only one avatar, on the first message of the run.

## Key decisions

- **Design system before Transcript.** User paused mid-brainstorm to build a design-system
  sub-project first, once it became clear the redesign would otherwise hardcode ad-hoc
  colors/spacing. The two plans were kept separate (not merged) with an explicit
  dependency, per `writing-plans`' scope-check guidance.
- **Incremental primitive adoption, not a forced sweep.** Only two real pre-existing
  duplicates were migrated onto the new primitives: Sidenav's health dot → `Dot`,
  Timeline's usage tags → `Pill`. `Button` ships with zero call-site migrations
  (intentional non-goal). `QuickPhrasesRow` gets a token-only CSS migration, explicitly
  *not* moved onto the `<Pill>` component — its delete-button + `ResizeObserver`-measured
  clone is tightly coupled to its own `.pill` class's box model, and forcing it through
  `Pill`'s generic API was judged not worth the risk for a cosmetic-only gain. This was a
  deliberate deviation from the original spec's literal wording, made once the actual
  component code was read during planning, and documented rather than silently applied or
  silently ignored.
- **Double-box removal.** `Message`'s outer `.bubble` wrapper is gone for assistant turns;
  `Timeline`'s own per-bubble boxes (text/thought/tool) now carry the visual weight
  directly, since they used to be nested inside that now-removed wrapper.
- **Header/toolbar cleanup deferred.** Flagged as a real pain point during discovery but
  explicitly out of scope here — left as a follow-up spec, not bundled in.
- **Prior uncommitted work on `main` got committed and pushed first.** At the start of the
  implementation phase, `main` had unrelated, coherent, uncommitted work sitting in the
  working tree (collapsible sidenav, composer drag-and-drop image attachments, a
  `/terminal` WS proxy fix, and a rebuilt frontend bundle) predating this session. That was
  split into 4 logical commits and pushed to `origin/main` before creating the isolated
  worktree for this feature, so the new work wouldn't get tangled with it.

## Incident: subagent committed to the wrong checkout

During Task 2 (`Dot` + Sidenav migration), the implementer subagent operated in the
original repo checkout (`/Users/bhanu-mac/Desktop/Projects/jarvis_bridge`, branch `main`)
instead of the assigned isolated worktree, despite an explicit "your working directory is
`<worktree path>`" instruction in its dispatch prompt. It committed its work onto `main`,
branched from before Task 1's tokens commit even existed — orphaning Task 2's code from
the tokens it depended on. The first task-reviewer dispatch, given that wrong base,
correctly flagged "Task 2 deletes Task 1's tokens" — an accurate read of a real,
if accidental, cross-branch divergence, not a false positive.

**Fix:** cherry-picked the stray commit onto the worktree on the correct base (content was
byte-identical, just relocated), soft-reset `main` back to its pre-incident commit (safe —
never pushed), and discarded only the duplicated files from that checkout's working tree,
leaving an unrelated, pre-existing "setup-simplification" WIP (a different, unrelated
in-progress feature touching backend config files) completely untouched throughout.
Re-reviewed the corrected commit against the correct base: approved.

**Process fix applied to every subsequent subagent dispatch in this session:** each
implementer/reviewer prompt now opens with a mandatory `cd` into the worktree path plus a
`pwd`/`git rev-parse --show-toplevel`/branch/last-commit self-check, with instructions to
report `BLOCKED` immediately if it doesn't match — and the controller independently
verifies each new commit's ancestry (`git merge-base --is-ancestor <prev-head> <new-head>`)
before trusting any subagent's "DONE" report, rather than trusting the report alone.

## Files modified

25 files across 11 commits (`6203030..41558ed`, fast-forwarded into `main`):

- `frontend/src/styles/tokens.css`, `tokens.test.ts`, `global.css` — token layers.
- `frontend/src/components/ui/{Dot,Avatar,Button,Pill}.{tsx,module.css,test.tsx}` — new
  primitives (12 files).
- `frontend/src/components/Sidenav.{tsx,module.css,test.tsx}` — `Dot` migration.
- `frontend/src/components/Timeline.{tsx,module.css}` — `Pill` usage-tag migration (Task
  5) and `Dot`-based tool-pill restyle (transcript-redesign Task 3).
- `frontend/src/components/QuickPhrasesRow.module.css` — token-only migration.
- `frontend/src/components/Message.{tsx,module.css,test.tsx}` — avatars, `showAvatar`
  prop, double-box removal.
- `frontend/src/components/Transcript.{tsx,test.tsx}` — consecutive-same-role grouping.

New reference doc: `docs/frontend-components.md` (summarizes the `ui/` primitives layer
for future reference, since no such doc existed before this session).

## Follow-up / next steps

- Header/toolbar cleanup in `ChatPanel.tsx` (9 flat buttons, cryptic "AA✓" auto-approve
  label) — explicitly deferred, needs its own brainstorm → spec → plan cycle.
- Adopt the new `Button` primitive in `InfoPanel`/`Composer`/`ChatPanel` next time any of
  those files are touched for another reason (no dedicated migration task planned).
- Minor, non-blocking findings from the final whole-branch review, left as-is: a
  pre-existing (not introduced by this branch) dead `styles.assistant` CSS-module
  reference in `Message.tsx`; `Pill`'s `neutral` tone being ~2px larger than other tones
  if ever mixed in one row; `Avatar`'s 28px size duplicated as a magic number in two
  files; `Avatar`'s `aria-label` being overridable via prop-spread order; 3 pre-existing
  unrelated `ChatContext.test.tsx` unhandled-rejection warnings (unaffected by this
  branch, left for a separate cleanup).
- `main` was merged locally but has not been pushed to `origin/main` yet — 11 commits
  ahead as of this session's end.
