# Quick Phrases Ranking (Frequency-Based)

## Overview

Sort the quick-phrase pills shown in the Composer's `QuickPhrasesRow` by usefulness, so the
phrases a user actually relies on surface first (and stay in the visible row rather than
falling into the `+N` overflow popup) instead of sitting in whatever order they were added.

**Strategy for this pass**: simple frequency — count how many times each phrase has been sent
via the picker, most-used first. This is explicitly a first cut; smarter "usefulness for the
current context" ranking (e.g. weighting by recency, or by relevance to the current
conversation) is deferred to a future spec once frequency-only ranking is in place and its
gaps are clearer.

**Non-goals** (explicitly out of scope for this spec):
- No context-aware ranking (current chat content, recency decay, time-of-day, etc.) — frequency
  only, per the strategy above.
- No change to `SettingsPanel`/`SettingsDialog`'s quick-phrase management lists — both keep
  insertion order, unchanged. Ranking applies only to `QuickPhrasesRow` (the composer picker).
- No change to `QuickPhrasesRow.tsx` itself — it stays a pure presentational component driven
  entirely by the `phrases` prop order, same as today.
- Manually typing text that happens to match a quick phrase does not count as a "use" — only
  clicking a pill (in the row or its overflow popup) does.
- No cap/decay/reset on counts, no UI to view or reset the counts — raw counts persist
  indefinitely until the phrase itself is deleted.

## Current State

- `frontend/src/state/quickPhrases.ts` — `loadQuickPhrases()`/`saveQuickPhrases()` persist a
  flat `string[]` under localStorage key `jarvis.quickPhrases`. Order is insertion order; it's
  both the storage order and the display order today.
- `frontend/src/components/QuickPhrasesRow.tsx` — pure presentational component. Takes
  `phrases: string[]` plus `onSubmit`/`onAdd`/`onDelete` callbacks and renders them in the given
  order, computing at render time (via `ResizeObserver` + an off-screen `.measure` clone) how
  many pills fit before falling back to a `+N` overflow popup. `onDelete(idx)` and the overflow
  popup's per-pill delete both index into whatever array it was handed.
- `frontend/src/components/Composer.tsx:46,63-82` — owns the `phrases` state
  (`useState(() => loadQuickPhrases())`), and defines:
  - `submitPhrase(phrase)` — passed as `QuickPhrasesRow`'s `onSubmit`. Fires only when a pill is
    clicked (row or overflow popup); dispatches the phrase via `onSteer`/`onQueue`/`onSend`
    depending on turn state. This is the exact, only "use" event we want to count.
  - `addPhrase(phrase)` / `deletePhrase(idx)` — mutate `phrases` state and call
    `saveQuickPhrases`. `deletePhrase(idx)` indexes into the `phrases` state array directly.
- `frontend/src/components/SettingsPanel.tsx` and `SettingsDialog.tsx` — separate management
  UIs for the same `jarvis.quickPhrases` list (add/delete only, plain `<ul>`, insertion order).
  Out of scope for this spec (see Non-goals).

## Design

### New state module: `quickPhraseUsage.ts`

Add `frontend/src/state/quickPhraseUsage.ts`, mirroring the load/save shape of
`quickPhrases.ts`:

```ts
export const QUICK_PHRASE_USAGE_KEY = "jarvis.quickPhraseUsage";

export function loadQuickPhraseUsage(): Record<string, number>;
export function recordQuickPhraseUse(phrase: string): Record<string, number>;
export function pruneQuickPhraseUsage(keep: string[]): Record<string, number>;
```

- Storage shape: `Record<phrase, count>` (phrase text is the key) under localStorage key
  `jarvis.quickPhraseUsage`, separate from `jarvis.quickPhrases` so the two can evolve/reset
  independently.
- `loadQuickPhraseUsage()` — same `safeGet`/`JSON.parse`/fallback-to-`{}` pattern as
  `loadQuickPhrases()`. Malformed/missing data returns `{}`.
- `recordQuickPhraseUse(phrase)` — loads current map, increments `map[phrase]` (defaulting
  absent keys to 0 first), persists, and returns the updated map so the caller can update React
  state from the return value without a second read.
- `pruneQuickPhraseUsage(keep)` — given the current list of surviving phrase strings, removes
  any map keys not in that list and persists. Called after a delete so counts don't silently
  accumulate for phrases that no longer exist.
- A phrase re-added later with the same text starts back at whatever count survived pruning —
  in practice 0, since prune runs on every delete. This is an acceptable, deliberately
  unhandled edge case (see Edge Cases).

### Composer changes

`frontend/src/components/Composer.tsx`:

1. Load usage alongside phrases: `const [usage, setUsage] = useState(() =>
   loadQuickPhraseUsage())`.
2. `submitPhrase(phrase)` additionally calls `setUsage(recordQuickPhraseUse(phrase))` before
   dispatching.
3. `deletePhrase(idx)` additionally calls `setUsage(pruneQuickPhraseUsage(next))` after computing
   the filtered `next` phrases array (`next` is the post-delete phrase list, so pruning against
   it removes exactly the deleted phrase's usage entry, plus any other orphaned entries as a
   safety net).
4. New `useMemo` computing the sorted display list and an index-translation table:

   ```ts
   const displayOrder = useMemo(
     () => phrases
       .map((text, originalIndex) => ({ text, originalIndex }))
       .sort((a, b) => (usage[b.text] ?? 0) - (usage[a.text] ?? 0)),
     [phrases, usage],
   );
   const displayPhrases = displayOrder.map((p) => p.text);
   const handleDelete = (displayIdx: number) => deletePhrase(displayOrder[displayIdx].originalIndex);
   ```

   `Array.prototype.sort` is stable in all engines this project targets (Node/V8, evergreen
   browsers), so phrases tied on count keep their relative order from `phrases` — i.e.
   insertion order — with no explicit tiebreaker code needed.
5. Pass `phrases={displayPhrases}` and `onDelete={handleDelete}` to `<QuickPhrasesRow>` instead
   of the raw `phrases` state and `deletePhrase` directly. `onSubmit={submitPhrase}` and
   `onAdd={addPhrase}` are unchanged — both already operate on phrase text or append to the end,
   neither depends on index-into-display-order.

No changes to `QuickPhrasesRow.tsx` — it continues to receive a plain `string[]` and index-based
callbacks; it has no awareness that the array it's given is sorted or that indices have been
translated.

### Files to modify

1. `frontend/src/state/quickPhraseUsage.ts` — new file (load/record/prune).
2. `frontend/src/state/quickPhraseUsage.test.ts` — new file, unit tests for the module.
3. `frontend/src/components/Composer.tsx` — usage state, `submitPhrase`/`deletePhrase` updates,
   `displayOrder`/`displayPhrases`/`handleDelete` wiring, updated props passed to
   `<QuickPhrasesRow>`.
4. `frontend/src/components/Composer.test.tsx` — new coverage (see Testing).
5. `docs/frontend-components.md` — add a short note under `QuickPhrasesRow`'s section
   documenting that display order now comes from `Composer` (frequency-sorted) rather than
   passing `phrases` state straight through, so a future reader doesn't assume prop order ==
   storage order.

### No changes needed

- `QuickPhrasesRow.tsx` / `QuickPhrasesRow.module.css` — unchanged, stays presentational.
- `SettingsPanel.tsx` / `SettingsDialog.tsx` — unchanged (see Non-goals).
- `quickPhrases.ts` — unchanged; `quickPhraseUsage.ts` is an additive sibling, not a
  modification.
- Backend / API contract — this is entirely client-side localStorage state, no server
  involvement.

## Edge Cases

1. **All phrases at 0 usage (fresh install / nobody's clicked a pill yet)** — every phrase ties
   at count 0, so the stable sort leaves `displayPhrases` identical to insertion order. Visually
   indistinguishable from today's pre-feature behavior, which is the intended default.
2. **Deleting a phrase, then re-adding the same text** — treated as a brand-new phrase with 0
   usage; its prior count is not restored. Acceptable per Non-goals — there's no phrase identity
   beyond exact text match, and re-accumulating history for "the same text" after an explicit
   delete would be surprising, not helpful.
3. **Duplicate phrase text added twice** (`addPhrase` doesn't currently dedupe, unchanged by this
   spec) — both entries share one usage-count key, since the map is keyed by text. Clicking
   either pill increments the same counter, so the two copies always move together in sort order.
   Not a new problem introduced by this spec; `addPhrase` already allowed duplicates.
4. **`localStorage` unavailable/throws** (private browsing, storage quota, test environments) —
   `quickPhraseUsage.ts` follows the exact `safeGet`/`safeSet` try/catch pattern already in
   `quickPhrases.ts`, so it degrades the same way: usage always reads as `{}`, every write is a
   silent no-op, and the row simply falls back to insertion order every render (case 1 above).
5. **Overflow popup interaction unaffected** — since `QuickPhrasesRow` still just slices whatever
   array it's given into `visible`/`hidden` by its own width-fitting logic, sorting most-used
   phrases first naturally means they're the ones most likely to land in the always-visible
   `visible` slice rather than behind `+N` — this is the actual point of the feature, not a side
   effect to guard against.

## Testing

- `quickPhraseUsage.test.ts`: `loadQuickPhraseUsage` returns `{}` on missing/malformed data;
  `recordQuickPhraseUse` increments an existing key and creates a new one at 1; `
  pruneQuickPhraseUsage` removes keys not in the `keep` list and leaves the rest untouched;
  persistence round-trips through `localStorage`.
- `Composer.test.tsx`: clicking a pill increments that phrase's usage and a subsequent render
  reflects the new sort order; clicking the *same* pill twice keeps incrementing (not just
  toggling); deleting a phrase removes its usage entry (verify via a second add of the same text
  starting back at the front, tied with other 0-count phrases); ties (including the all-zero
  default state) preserve insertion order; deleting a phrase that is not in first position still
  deletes the correct underlying phrase (regression check for the display-index-to-original-
  index translation).
- Run `cd frontend && npm run test:web`.
