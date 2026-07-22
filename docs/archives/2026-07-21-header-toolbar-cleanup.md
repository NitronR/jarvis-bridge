# Header/Toolbar Cleanup

**Date:** 2026-07-21
**Session:** opencode/big-pickle (Phase 3 frontend redesign)

## Summary

Completed Phase 3 of the jarvis_bridge frontend redesign: Header/Toolbar Cleanup. Regrouped
ChatPanel's header from 8 flat buttons into primary/secondary groups with a divider, migrated
all raw `<button>` elements onto the `Button` primitive (first call-site adoption), replaced
the cryptic "AA✓" auto-approve label with a self-explanatory "Auto-approve" toggle, and
polished the Button component with rounded corners, smooth transitions, focus-visible ring,
and active press feedback.

## Key decisions

- **Primary/secondary grouping with divider.** Primary (＋ New, ↓ Follow, ☰ Chats) gets
  accent styling; secondary (Info, + New in..., Fork, Steer, Auto-approve) stays default.
  Vertical 1px divider between groups.
- **Unicode symbols for primary icons, text-only for secondary.** Zero new dependencies.
  Primary icons (＋, ↓, ☰) aid quick recognition; secondary buttons are less frequent and
  don't need icons.
- **"Auto-approve" as button toggle state.** Full word, no abbreviation. Uses existing
  `onAutoApproveToggle` callback shared with InfoPanel. `variant="primary"` when on, default
  when off.
- **"+ New in..." moved to secondary group.** Situational button (only when
  `customWorkingDirectory` capability is available), doesn't belong in primary.
- **Button primitive polished globally.** `--radius-sm` → `--radius-md` (4px), added
  transitions, `:focus-visible` accent ring, `:active` scale. These changes affect all
  `Button` consumers, not just ChatPanel.
- **CSS specificity fix.** `.header button` → `.header :global(button)` to prevent specificity
  wars with `Button.module.css`.

## Files modified

- `frontend/src/components/ChatPanel.tsx` — Button import, regrouped header markup
- `frontend/src/components/ChatPanel.module.css` — divider rule, `:global(button)`, padding tweak
- `frontend/src/components/ChatPanel.test.tsx` — fixed "Chats" query, added 2 header tests
- `frontend/src/components/ui/Button.module.css` — radius, transitions, focus, active state
- `docs/design/redesign-phases.md` — Phase 3 marked Done
- `docs/superpowers/specs/2026-07-21-header-toolbar-cleanup-design.md` — spec
- `docs/superpowers/plans/2026-07-21-header-toolbar-cleanup.md` — plan

## Process notes

- Followed full brainstorming → spec → plannotator → writing-plans → subagent-driven-development
  pipeline.
- Used visual companion for button grouping, auto-approve label, and icon style decisions.
- 3 implementation tasks, each with implementer + spec reviewer + code quality reviewer.
- Spec compliance review caught two issues (missing `variant="primary"` on Chats button,
  extra icons on secondary buttons) — fixed before final review.
- Final review caught one more issue (inline handler instead of shared `onAutoApproveToggle`
  callback) — fixed before commit.
- No commits until user explicitly requested commit + push.

## Pre-existing issues noted (not introduced by this work)

- `InfoPanel.test.tsx` has a type error (missing `backendKind` property in mock)
- ChatPanel tests fail at matcher level (`toBeInTheDocument` not found) due to
  vitest/jest-dom ESM/CJS incompatibility — pre-existing, unrelated

## Follow-up

- Phase 4: Composer + Info Panel Audit (needs heuristic audit before any visual changes)
- `Button` adoption in `InfoPanel`/`Composer` when those files are next touched
- Consider fixing the pre-existing vitest/jest-dom ESM incompatibility
