# Quick phrases overflow popup: two hover bugs fixed

**Date**: 2026-07-22

## Summary

`QuickPhrasesRow`'s "+N" overflow pill is supposed to show a popup with the hidden phrases
on hover. Two separate bugs made it effectively unusable, found and fixed in the same
session, each via `systematic-debugging`:

1. **Popup never appeared at all.** `.row` (the flex container of pills) had
   `overflow: hidden`. `.overflowPopup` is an absolutely-positioned descendant placed
   *above* the row (`bottom: 100%`). React's hover state (`overflowHovered`) was toggling
   correctly and the popup was rendering in the DOM, but it was invisible — clipped by its
   own ancestor's `overflow: hidden`. That property wasn't load-bearing: the visible pill
   count is already controlled in JS (`phrases.slice(0, visibleCount)`), and the offscreen
   `.measure` element self-hides via its own `visibility: hidden; height: 0; overflow: hidden`.
   Fix: removed `overflow: hidden` from `.row`.

2. **Popup appeared but closed before you could click a phrase.** After fixing (1), hovering
   the "+N" pill opened the popup, but moving the cursor up into it to click a phrase closed
   it first. Root cause: `.overflowPopup` used `margin-bottom: var(--space-2)` for the visual
   gap above the pill. A margin sits *outside* an element's box, so that gap belonged to
   neither `.overflow` (the hover trigger) nor `.overflowPopup` — moving the cursor through it
   fired `mouseleave` on `.overflow`, unmounting the popup mid-transit. Confirmed with a
   pixel-stepping Playwright repro against the live dev server: the popup reliably vanished
   the instant the cursor entered the ~3px gap. Fix: moved the gap into `padding-bottom` on
   the outer `.overflowPopup` (now part of its hoverable box) and split the visible chrome
   (background/border/padding) into a new inner `.overflowPopupInner` wrapper, so the
   hoverable area is contiguous with the trigger — no dead zone.

## Key decisions

- Preferred shrinking/removing incidental CSS (`overflow: hidden` that wasn't actually needed
  for layout correctness) over adding complexity like a React portal, since the codebase has
  no existing portal pattern for popups/menus.
- Verified both fixes empirically against the running dev server (localhost:5173, backend on
  3001) with scripted Playwright repros — not just unit tests — since this is fundamentally a
  hover-interaction/visual bug that unit tests alone wouldn't catch. `QuickPhrasesRow.test.tsx`
  had no coverage for the hover-popup behavior at all before or after this session.

## Files modified

- `frontend/src/components/QuickPhrasesRow.module.css` — removed `.row`'s `overflow: hidden`;
  replaced `.overflowPopup`'s `margin-bottom` with `padding-bottom` and split its visual
  styling into a new `.overflowPopupInner` class.
- `frontend/src/components/QuickPhrasesRow.tsx` — wrapped the hidden-phrase `Pill` list in the
  new `.overflowPopupInner` div.
- `docs/frontend-components.md` — documented both constraints under the `QuickPhrasesRow`
  entry so they aren't reintroduced.

## Follow-up / next steps

- No regression test exists for "popup stays open while the cursor moves from the trigger to
  a phrase inside it." Worth adding if this area sees more churn — the existing test suite
  (jsdom-based) can't easily assert pixel-level hover-through behavior; would need either a
  Playwright/browser test or a simplified DOM-structure assertion (e.g. popup is a DOM
  descendant of the hover-trigger element, gap is padding not margin).
- No other overflow-hover UI in the codebase was audited for the same margin-gap dead-zone
  pattern; worth a quick grep (`margin-bottom` near `position: absolute` popups) if similar
  hover menus get added elsewhere.
