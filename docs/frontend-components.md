# Frontend Component Primitives

`frontend/src/components/ui/` holds a small shared primitives layer, introduced by the
2026-07-21 design-system work (see `docs/superpowers/specs/2026-07-21-design-system-design.md`
for the original rationale and token layering, and
`docs/superpowers/specs/2026-07-21-transcript-redesign-design.md` for how the Transcript
consumes `Avatar`/`Dot`). This file is the living reference — update it when a primitive's
API changes, rather than re-reading the specs, which describe intent at time of writing.

## Token layering

`frontend/src/styles/tokens.css` layers three kinds of custom properties:

1. **Primitive** — raw values: `--color-*`, `--space-1` (2px) through `--space-10` (24px),
   `--font-size-1` (10px) through `--font-size-7` (16px), `--font-weight-*`, `--radius-*`.
2. **Semantic/tint** — derived from primitives: `--color-accent-tint`, `--color-success-tint`,
   `--color-danger-tint`.
3. **Component-layer** — named per consumer, e.g. `--button-primary-bg`, `--pill-neutral-fg`,
   `--dot-ok`, `--avatar-user-border`. Each `ui/` primitive below consumes only its own
   component-layer tokens plus the primitive spacing/type scale — never a raw hex/px value.

`frontend/src/styles/tokens.test.ts` pins every token's existence and, for the two
`global.css` wiring points (`body` font-size, `button.primary` color), its exact value —
extend this file rather than adding a parallel test when a new token lands.

## `Dot` — status indicator

`frontend/src/components/ui/Dot.tsx`

```tsx
<Dot status="ok" />  // "idle" (default) | "ok" | "bad" | "progress"
```

8px circle. `progress` renders a spinning ring (`Dot.module.css`'s own `@keyframes spin`) —
this is the only place the spin animation lives; don't reintroduce a local copy elsewhere.
Forwards all `HTMLAttributes<HTMLSpanElement>` (used for `data-testid` in tests, and by
`Timeline`'s tool-call pills). Consumers: `ChatPanel`'s header title, `Timeline`'s tool-call
status pill.

## `Avatar` — role initials

`frontend/src/components/ui/Avatar.tsx`

```tsx
<Avatar role="user" />       // renders "Y", aria-label="You"
<Avatar role="assistant" />  // renders "AI", aria-label="Assistant"
```

28px circle. Sets `aria-label` itself from the `role` — note this is set *before* the
`{...rest}` spread, so a caller-supplied `aria-label` in rest props will override it (no
current caller does this; if one ever needs to, that's why it's possible). Consumer:
`Message.tsx` (one per message, hidden behind a same-sized `.avatarSpacer` when
`Transcript` groups consecutive same-role messages — see `Message.module.css`'s
`avatarSpacer` comment for the exact 28×28 coupling to keep in sync if `Avatar`'s size ever
changes).

## `Button`

`frontend/src/components/ui/Button.tsx`

```tsx
<button>Cancel</button>                     // default: outlined, 4px radius
<Button variant="primary">Send</Button>     // accent background, bold
<Button variant="danger">Stop</Button>      // danger border/text
```

Renders with `--radius-md` (4px rounding), smooth hover/focus transitions, a
`--color-accent` focus-visible ring, and a subtle `:active` scale press. First adopted by
`ChatPanel`'s header toolbar (Phase 3: Header/Toolbar Cleanup), then `Composer`'s action row
(Phase 4: Composer Redesign). `InfoPanel` still uses raw `<button>` — migrate whenever that
file is next touched.

**Deliberately not migrated**: `QuickPhrasesRow`'s pill/add/delete/overflow buttons stay bare
`<button className={styles.x}>` elements rather than `<Button>`, for the same reason its pill
isn't run through the `Pill` primitive either (see below): they're tightly coupled to a
`ResizeObserver`-measured clone of their own box model, and `Button`'s own border/padding
would need overriding anyway with no visual gain — any mismatch between the real element and
its hidden measurement clone silently breaks the overflow-cutoff math.

## `Pill`

`frontend/src/components/ui/Pill.tsx`

```tsx
<Pill>in 120</Pill>                 // tone="neutral" (default)
<Pill tone="danger">error</Pill>    // "neutral" | "accent" | "success" | "danger"
```

Fully-rounded chip (`--radius-full`). Only `tone="neutral"` carries a border
(`1px solid var(--color-border)`, matching the one existing consumer's original look);
`accent`/`success`/`danger` are borderless. This means a `neutral` pill is ~2px larger than
the other tones if ever placed in the same row — harmless today since `Timeline`'s usage-tag
migration is the only consumer and always uses `neutral`, but worth a `box-sizing`/matching
transparent border if a future consumer mixes tones side-by-side.

**Not migrated**: `QuickPhrasesRow`'s own pill (delete button composed inside a clickable
label, plus a hidden `ResizeObserver`-measured clone tightly coupled to its own `.pill`
class's box model) intentionally stays a bare `<span>`, tokenized but not swapped onto
`<Pill>` — forcing it through `Pill`'s generic `children`-only API would risk breaking the
width measurement for no visual gain.

`QuickPhrasesRow`'s overflow ("+N") indicator is a real, keyboard-operable `<button>` (not a
hover trigger) — `aria-haspopup`/`aria-expanded`, opens on click, closes on click-outside,
Escape, or blur (Phase 4: Composer Redesign). One CSS constraint from its original
implementation still applies and is easy to reintroduce accidentally: `.row` must not set
`overflow: hidden` — the popup is an absolutely-positioned descendant placed *above* the row
(`bottom: 100%`), so a clipping ancestor hides it outright regardless of open/close state.
(An earlier, hover-driven version of this popup also required the visual gap above the pill
to come from `padding-bottom` on `.overflowPopup` rather than `margin-bottom`, to avoid a
`mouseleave` dead zone — see `docs/archives/2026-07-22-quick-phrases-overflow-popup-fixes.md`.
That specific reasoning no longer applies now that open/close isn't hover-driven, but the
`.overflowPopupInner` split it produced was kept as-is.)

## `Select` — custom listbox combobox

`frontend/src/components/ui/Select.tsx`

```tsx
<Select
  value={currentModel}
  options={models.map((m) => ({ value: m, label: m }))}
  onChange={onModelChange}
  disabled={models.length === 0}
  aria-label="Model"
/>
```

Not a native `<select>` — a `role="listbox"`/`role="option"` combobox with its own
open/close state, keyboard nav (`ArrowUp`/`ArrowDown`/`Enter`/`Space` on the trigger to
open, same keys plus `Escape` inside the open list), click-outside-to-close, and
auto-flip placement (`top`/`bottom`) based on available viewport space
(`useLayoutEffect` measuring `getBoundingClientRect()` against `options.length *
OPTION_HEIGHT`). Escape restores focus to the trigger button, matching
`QuickPhrasesRow`'s overflow-popup pattern above. First and only consumer: `Composer`'s
model selector (Phase 4: Composer Redesign) — chosen over a native `<select>`
mid-implementation for a more consistent, stylable dropdown; see Edge Case 8 of
`docs/superpowers/specs/2026-07-22-composer-redesign-design.md`.

## `JsonView` — syntax-highlighted JSON renderer

`frontend/src/components/ui/JsonView.tsx`

```tsx
<JsonView content={someObject} />
<JsonView content={someObject} maxHeight={240} />
<JsonView content={someObject} maxHeight={320} copyButton />
```

Zero-dependency recursive JSON renderer with syntax coloring and depth limiting.
Consumed by `Timeline.tsx` for tool call args and results.

- **Props**: `content: unknown` (raw value or string), `maxHeight?: number` (scrollable
  overflow, default 320), `copyButton?: boolean` (shows a hover-visible copy-to-clipboard
  button), `className?: string`.
- **Depth limit**: objects/arrays beyond depth 3 collapse to `…N keys` / `…N items`.
  Trivial values (strings, empty objects/arrays) render as plain `<span>` without
  `JsonNode` recursion.
- **Syntax tokens** use design-system CSS custom properties: `styles.str` (strings — blue),
  `styles.num` (numbers — light blue), `styles.bool` (booleans — red), `styles.key` (object
  keys — green), `styles.brace`/`styles.punc` (structural — muted), `styles.null`
  (null/undefined/depth-collapsed — muted).
- **Layout**: `.block` wraps content with padding, `.scrollable` enables overflow when
  `maxHeight > 0`. The copy button (`.copyBtn`) is positioned top-right, visible on hover.
- **Not a JSON tree viewer**: does not support expand/collapse per-node — intentionally
  kept flat-rendered for simplicity and zero dependencies. If collapsible trees are needed
  in the future, extend `JsonNode` rather than replacing with a library, since this
  component is already the single point of control for tool rendering.
- **Test**: `JsonView.test.tsx` is a follow-up task — no test exists yet.

## `backendKind` threading

`ChatState.backendKind` (set from `ChatInitResponse.backend.kind` during `GET /chat/init`)
flows through `ChatContext` → `ChatPanel` → `Transcript` → `Message` → `Timeline`. The
`TimelineProps.backendKind` prop is passed to `renderBubble` (currently as `_backendKind`,
unused but available). This plumbing enables backend-specific rendering in `renderBubble`
without further prop-threading — e.g., showing `_meta.claudeCode.toolName` for Claude or
`locations[]` for opencode.

## Conventions shared by all six primitives

- One `.tsx` + one `.module.css` + one `.test.tsx`, in `ui/`.
- Variant/tone/status/role prop is optional with a sensible default, typed as a string
  union exported alongside the component (`DotStatus`, `AvatarRole`, `ButtonVariant`,
  `PillTone`).
- `className` composition pattern: `[styles.base, styles[variant], className].filter(Boolean).join(" ")`.
- Extends the relevant `HTMLAttributes`/`ButtonHTMLAttributes` and spreads `...rest` last,
  so callers can pass `data-testid`, event handlers, etc. through unchanged.
