# Quick phrases: from half-built settings feature to composer pill row

**Date:** 2026-07-14
**Time:** 14:02 IST

## Summary of work done

Started by auditing the "quick phrases" feature, which turned out to be half-built:
`SettingsPanel.tsx` had full CRUD (add/remove, persisted to `localStorage["jarvis.quickPhrases"]`)
and dispatched a `jarvis:quick-phrases-changed` `CustomEvent`, but nothing in the codebase
listened for that event or consumed the phrase list — including the settings list itself,
whose "Click to insert into the composer" copy had no `onClick` wired to it. `Composer.tsx`
had no insertion surface at all. (`App.tsx` route-switches `SettingsPanel`/`ChatPanel` in
and out of the DOM rather than keeping them mounted together, which simplified the fix:
no live cross-component sync was needed, just load-on-mount.)

Built the feature out in three iterations, each driven by follow-up user feedback:

1. **First pass** — extracted shared `frontend/src/state/quickPhrases.ts`
   (`loadQuickPhrases`/`saveQuickPhrases`, same safe-localStorage pattern as
   `recentWorkspaces.ts`), pointed `SettingsPanel` at it, and added a ⚡ button + dropdown
   in `Composer.tsx` that inserted a clicked phrase into the textarea (appending to
   existing draft text, not overwriting).
2. **Redesign to pills** — user asked for phrases shown as horizontally arranged pills
   above the input, overflowing into a hover-revealed "+N" badge, each pill with a red-X
   delete button. Replaced the ⚡ dropdown with a new `QuickPhrasesRow` component
   (`frontend/src/components/QuickPhrasesRow.tsx` + `.module.css`) that does real DOM
   measurement: a hidden `aria-hidden` row renders all pills off-screen to get natural
   widths via `offsetWidth`/`clientWidth`, a `ResizeObserver` on the visible container
   recomputes on resize, and the overflow badge's own measured width is reserved so it
   never gets pushed off by the last visible pill.
3. **Submit-on-click instead of insert** — user changed their mind on the interaction:
   clicking a pill should submit that phrase as a message immediately (routed through
   the same busy/steer branching as the normal Send button — `onSteer` if steering,
   `onQueue` if busy, else `onSend`), not populate the textarea. The composer's own draft
   text is left untouched by a pill click. Renamed the row's callback prop
   `onInsert` → `onSubmit` throughout.
4. **Inline add button** — added a `+` pill before the first phrase pill that toggles an
   inline `<input>` (Enter commits and clears the field but keeps it open for adding
   several in a row; Escape or blur cancels without saving; blank/whitespace-only Enter
   is treated as cancel). Its measured width is now factored into the overflow
   calculation alongside the pills and the "+N" badge.

Also had to add a `ResizeObserver` stub to `frontend/src/test-setup.ts` (jsdom doesn't
implement it) — same global-stub pattern the file already used for `localStorage`.

## Key decisions made

- Shared load/save functions in `state/quickPhrases.ts` rather than a hook with an
  event-subscription — justified by `App.tsx`'s route-switch unmount/remount behavior
  making live sync unnecessary; avoided the more complex hook per the "don't
  over-engineer" guidance.
- Pill-click semantics ended up as **submit**, not **insert-then-let-user-hit-send** —
  this was an explicit user course-correction mid-session, not the original design.
- Deletion has no undo/confirmation — flagged to the user as a possible follow-up, not
  yet actioned.
- SettingsPanel's "Click to insert..." / "Available from the ⚡ picker..." copy is now
  stale again after the pill-row redesign (no ⚡ button exists anymore) — flagged, not
  yet fixed.

## Files modified

- `frontend/src/state/quickPhrases.ts` (new) — shared localStorage load/save
- `frontend/src/state/quickPhrases.test.ts` (new)
- `frontend/src/components/QuickPhrasesRow.tsx` (new) — pill row, overflow measurement,
  inline add
- `frontend/src/components/QuickPhrasesRow.module.css` (new)
- `frontend/src/components/QuickPhrasesRow.test.tsx` (new)
- `frontend/src/components/Composer.tsx` — replaced ⚡ dropdown with `<QuickPhrasesRow>`;
  `dispatch`/`submitPhrase`/`addPhrase`/`deletePhrase` helpers
- `frontend/src/components/Composer.module.css` — removed now-unused `.phrasesWrap`/
  `.phrasesMenu`/`.phrasesEmpty` rules
- `frontend/src/components/Composer.test.tsx` — updated/added tests for submit-on-click,
  busy/steer routing, add, delete
- `frontend/src/components/SettingsPanel.tsx` — now uses shared `quickPhrases.ts`
  functions instead of its own local `load`/`save`; copy line updated once (now stale
  again, see above)
- `frontend/src/test-setup.ts` — added `ResizeObserver` stub

Typecheck clean; full frontend suite passing (140/140, plus 3 pre-existing unrelated
`ChatContext.test.tsx` fetch-URL errors not touched by this work).

## Follow-up tasks / next steps

- Fix `SettingsPanel.tsx`'s stale quick-phrases helper copy (no more ⚡ picker).
- Decide whether `SettingsPanel`'s separate add/remove UI is still worth keeping now
  that the composer can add and delete phrases inline — could simplify Settings to a
  read-only list + remove, or drop the section entirely.
- Consider a delete confirmation, since the pill's red-X removes a phrase with no undo.
- Manual browser verification of the full flow (add via `+`, submit via pill click,
  delete via ×, overflow "+N" hover popup at real pixel widths) is still outstanding —
  everything above was verified via typecheck + Vitest only.
