# Transcript Redesign

## Overview

Redesign the chat transcript (`Message.tsx` + `Timeline.tsx` + `Transcript.tsx`) for better
scanability and a warmer visual style, following the process in
`docs/guidelines/ui-ux-process.md`. This is a presentational change only — no changes to
`ChatPatch`, `MessageEntry`, or any chat state/data flow.

**Driver**: both a visual refresh and concrete usability pain points, surfaced via a
heuristic pass (see Current State below) and confirmed with the user rather than assumed.

**Non-goals** (explicitly out of scope for this spec):
- Header/toolbar cleanup (`ChatPanel.tsx` header row, 9 flat buttons) — flagged as a real
  pain point during discovery, but deferred to a **follow-up spec** rather than bundled here.
- Composer and Info panel — not raised as pain points, left untouched.

**Dependency**: this spec now builds on
`docs/superpowers/specs/2026-07-21-design-system-design.md` (approved) — the `Avatar` and
`Dot` primitives it defines must exist in `frontend/src/components/ui/` before this spec's
implementation plan starts. This section and the tool-pill styling below were updated after
that spec landed to consume those primitives instead of inlining their own markup.

## Current State

`Transcript.tsx` renders one `Message` per transcript entry (`role: "user"` or
`role: "assistant"`). Each `Message`:
- Shows a plain uppercase text label ("You" / "Assistant") — no avatar, no visual anchor.
- Wraps its content in an outer `.bubble` div (`Message.module.css`) with its own
  background/border/radius.
- For assistant entries, that outer bubble wraps `Timeline`, whose own bubbles
  (text/thought/tool) *each* have their own background/border/radius (`Timeline.module.css`)
  — producing a double-nested box look for every assistant turn.
- Tool calls render as bordered `<details>` blocks, collapsed by default, differentiated
  only by border color (blue=in-progress, green=success, red=error).

Heuristic-evaluation findings that motivate this redesign (confirmed with user):
1. No avatars/visual anchors — hard to scan a long transcript at a glance.
2. Assistant turns are visually cluttered from the double-box nesting described above.
3. Tool/thought/text bubbles look structurally similar, differentiated mainly by a subtle
   border-color accent.

Header toolbar sprawl was also flagged but is out of scope here (see Non-goals).

## Design

### Visual direction

Chosen via side-by-side mockup comparison (dense dev-tool / warm chat-app / hybrid
scannable) — **warm chat-app style** selected: avatars, rounded bubbles, generous spacing.
Tool-heavy turns are kept manageable by relying on the existing collapsed-by-default
`<details>` behavior (unchanged) rather than compressing spacing — a 10-tool-call turn shows
as 10 short pills, not exploded content.

### Avatars

- `Message` renders `<Avatar role="user" />` / `<Avatar role="assistant" />` from
  `frontend/src/components/ui/Avatar.tsx` (design-system spec) — sizing, colors, initials,
  and `aria-label`s are all owned by that component, not redefined here.
- Layout: positioned left for assistant / right for user (row-reverse), one per `Message`.
  The visible text label ("You"/"Assistant") is dropped in favor of avatar position + color;
  `Avatar`'s `aria-label` preserves the accessible name.

### Consecutive-message grouping

Confirmed requirement: when multiple entries of the **same role** appear back-to-back with no
opposite-role entry between them (e.g. consecutive assistant turns), only the **first**
message in that run shows its avatar. Subsequent messages in the run render an empty spacer
matching the avatar's width, keeping the bubble column aligned. This rule applies uniformly
to both roles for consistency, even though user-role runs are rare in practice.

- `Transcript.tsx` computes this: for entry at index `i`, `showAvatar = i === 0 ||
  entries[i].role !== entries[i - 1].role`.
- `Message` accepts a new optional prop `showAvatar?: boolean`, **defaulting to `true`** when
  omitted, so existing calls in `Message.test.tsx` (which don't pass the prop) keep passing
  unchanged.

### Removing the double-box

`Message`'s outer `.bubble` wrapper is removed for assistant entries. `Timeline`'s bubbles
(text/thought/tool) render directly inside the avatar's column — each bubble type keeps (and
restyles) its own visual treatment, but there's no longer an extra enclosing box around the
whole turn. User entries (plain text + optional images, no `Timeline`) keep a single bubble,
now styled per the tokens below.

### Bubble & tool-pill styling

- New token in `tokens.css`: `--radius-bubble: 16px`. Bubbles and tool pills both use it;
  the "tail" corner (bottom-left for assistant, bottom-right for user) uses the existing
  `--radius-md` (4px) for a subtle asymmetric-rounding effect.
- Assistant text bubble: `--color-surface-2` background, no border.
- User text bubble: `--color-accent-tint` background, `--color-accent` border (unchanged
  colors from today, just the new radius).
- Tool pill (collapsed): `--color-surface-1` background, `--radius-bubble`, renders
  `<Dot status={!result ? "progress" : result.ok ? "ok" : "bad"} />` from
  `frontend/src/components/ui/Dot.tsx` (design-system spec — `progress` keeps the existing
  spinner) instead of a colored border, followed by the monospace `toolName` (already the
  full descriptive intent string when `p.intent` is set, e.g. "readFile Composer.tsx" — no
  separate label field needed).
- Tool pill (expanded, via existing `<details>` click): same container, args shown in a
  `<pre>` block below the summary row, matching current content but restyled to the new radius/
  color tokens.
- Thought bubbles: unchanged behavior (expanded by default), restyled as plain italic muted
  text with no background/box, consistent with the lighter-weight treatment in the approved
  mockup.
- Error state: assistant bubble background becomes a `--color-danger`-tinted red with a
  `--color-danger` border, replacing today's border-only error treatment.

### Files to modify

1. `frontend/src/styles/tokens.css` — add `--radius-bubble` as a component-layer token
   (same layering convention the design-system spec establishes; this token is specific to
   message bubbles, so it's added here rather than in that spec's own token list).
2. `frontend/src/components/Message.tsx` — render `Avatar`, `showAvatar` prop (default
   `true`), remove outer bubble wrapper for assistant entries.
3. `frontend/src/components/Message.module.css` — layout only (avatar column, spacer sizing
   matching `Avatar`'s width) — no color/initial styling, that's owned by `Avatar.module.css`.
4. `frontend/src/components/Timeline.tsx` — render `Dot` in the tool-pill summary instead of
   a colored border wrapper; no structural/data changes.
5. `frontend/src/components/Timeline.module.css` — pill/bubble token updates.
6. `frontend/src/components/Transcript.tsx` — compute and pass `showAvatar` per entry.

### No changes needed

- `ChatPatch` / `MessageEntry` types — purely presentational.
- `ChatPanel.tsx`, `Composer.tsx`, `InfoPanel.tsx` — out of scope (see Non-goals).

## Edge Cases

1. **Single assistant entry, no consecutive run** — avatar always shows (existing default
   behavior via `showAvatar` defaulting to `true`).
2. **Long run of consecutive assistant turns** (e.g. after steering/queueing) — only the
   first shows an avatar; the rest align under the spacer.
3. **Error mid-turn** — error bubble still gets the danger-tinted treatment even when it's
   not the first bubble in the turn's column.
4. **No result yet (in-progress tool call)** — pill keeps the existing spinner next to the
   accent-colored dot.

## Testing

- Existing `Message.test.tsx` assertions (error class on `firstElementChild`, text-content
  checks for user/assistant/error cases) should keep passing — root element and its classes
  are preserved, only internal structure changes.
- Existing `Transcript.test.tsx` ("renders one Message per entry") should keep passing
  unchanged.
- Add a new `Transcript.test.tsx` case: given two consecutive `role: "assistant"` entries,
  assert the second `Message` does not render a visible avatar (e.g. query for the
  `aria-label="Assistant"` element and assert it appears exactly once).
- Run `cd frontend && npm run test:web`.

## Follow-up (separate spec, not this one)

Header/toolbar cleanup in `ChatPanel.tsx` — regroup the 9 flat buttons into primary/secondary
groups with icons, replace the cryptic "AA✓" auto-approve label with something
self-explanatory.
