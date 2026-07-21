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
`Timeline`'s tool-call pills). Consumers: `Sidenav`'s health indicator, `Timeline`'s tool-call
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
<Button>Cancel</Button>
<Button variant="primary">Send</Button>
<Button variant="danger">Stop</Button>
```

Renders pixel-identically to the existing raw `<button>` styling in `global.css` (same
padding, same border). **Not yet adopted by any call site** — `InfoPanel`/`Composer`/
`ChatPanel` still use raw `<button className="primary">`. This is intentional per the
design-system plan's incremental-adoption approach, not an oversight; migrate a call site
onto `Button` next time that file is touched for another reason, rather than doing a
dedicated sweep.

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

## Conventions shared by all four primitives

- One `.tsx` + one `.module.css` + one `.test.tsx`, in `ui/`.
- Variant/tone/status/role prop is optional with a sensible default, typed as a string
  union exported alongside the component (`DotStatus`, `AvatarRole`, `ButtonVariant`,
  `PillTone`).
- `className` composition pattern: `[styles.base, styles[variant], className].filter(Boolean).join(" ")`.
- Extends the relevant `HTMLAttributes`/`ButtonHTMLAttributes` and spreads `...rest` last,
  so callers can pass `data-testid`, event handlers, etc. through unchanged.
