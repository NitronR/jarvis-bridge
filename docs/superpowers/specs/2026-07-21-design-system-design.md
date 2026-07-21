# Design System — Token Layering & Shared Primitives

## Overview

Formalize a lightweight design system for the frontend before continuing the paused
Transcript redesign (`docs/superpowers/specs/2026-07-21-transcript-redesign-design.md`),
per feedback from plannotator review of that spec. Scope: extend `tokens.css` with a
primitive → semantic → component token layering (per
`docs/guidelines/ui-ux-process.md` Stage 6), add a spacing scale and typography scale, and
extract four shared component primitives (`Button`, `Pill`, `Dot`, `Avatar`) into a new
`frontend/src/components/ui/` directory.

This is grounded in an audit of the actual codebase, not invented from scratch (see Current
State) — scope was deliberately kept to patterns with real, existing duplication, plus
`Avatar`, which the Transcript spec needs next.

## Current State (audit findings)

Ran across all `frontend/src/components/*.module.css`:

- **Colors**: already well-tokenized — only one stray hardcoded `#fff`
  (`WorkspacesDrawer.module.css:66`). No color work needed here.
- **Border-radius**: mostly tokenized (`--radius-sm/md/lg`), except pill shapes
  (`border-radius: 999px`) hardcoded 4x in `QuickPhrasesRow.module.css`, and `Timeline`'s
  usage tags use an untokenized `10px`.
- **Spacing**: 16+ distinct raw px values in `padding`/`margin`/`gap` (2, 4, 6, 8, 10, 12,
  14, 16, 20, 24px and combinations) — no scale, no tokens.
- **Typography**: 7 distinct raw `font-size` values (10, 11, 12, 13, 14, 15, 16px) and 3
  distinct `font-weight` values (500, 600, 700) — no scale, no tokens. Body default is
  `14px` (set directly in `global.css`, not via a token).
- **Button variants**: `global.css` already defines a solid base (`button`, `.primary`,
  `.danger`) using semantic color tokens — but every call site hand-types
  `className="primary"` / `className="danger"` as a raw string (8+ files: `ChatPanel.tsx`,
  `Composer.tsx`, `ApprovalModal.tsx`, `ElicitationModal.tsx`, `InfoPanel.tsx`, …). No
  shared `Button` component exists.
- **Status dot**: `Sidenav.tsx` computes a health-dot color class (`ok`/`bad`/neutral)
  inline; the paused Transcript spec independently designs a near-identical tool-call status
  dot (`ok`/`bad`/`progress`). No shared primitive exists — about to be duplicated.
- **Avatar**: zero current usages. Only the paused Transcript spec needs one so far.

## Design

### Token layers

Three layers, all in `tokens.css` (single file — the codebase is small enough that
splitting into multiple files would be premature):

1. **Primitive** — new raw-value tokens: the spacing scale and type scale below, plus
   `--radius-full: 999px`. Existing color hex values (`--color-accent: #4ea3ff`, etc.)
   already function as this layer's color primitives — not renamed.
2. **Semantic** — the existing `--color-*`, `--radius-sm/md/lg` tokens. **Unchanged**,
   zero rename risk to any existing consumer.
3. **Component** — new, narrow: only added where a primitive's default component styling
   is defined, e.g. `--button-primary-bg: var(--color-accent)`,
   `--avatar-assistant-bg: var(--color-surface-3)`, `--dot-ok: var(--color-success)`. This
   indirection is what lets a future per-component override happen without touching the
   component's code or the semantic layer — not built speculatively beyond what the four
   new primitives actually need.

### Spacing scale

A 2px-step numeric scale spanning the audit's observed range. Values are chosen to exactly
match what's already in use, so migrating a call site is a mechanical raw-px → token swap
with **zero visual change**:

| Token | Value | Token | Value |
|---|---|---|---|
| `--space-1` | 2px | `--space-6` | 12px |
| `--space-2` | 4px | `--space-7` | 14px |
| `--space-3` | 6px | `--space-8` | 16px |
| `--space-4` | 8px | `--space-9` | 20px |
| `--space-5` | 10px | `--space-10` | 24px |

### Typography scale

Same approach — one token per observed value, plus weight tokens for the 3 observed
weights:

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--font-size-1` | 10px | | `--font-size-5` | 14px (body default) |
| `--font-size-2` | 11px | | `--font-size-6` | 15px |
| `--font-size-3` | 12px | | `--font-size-7` | 16px |
| `--font-size-4` | 13px | | | |

`--font-weight-regular: 400`, `--font-weight-medium: 500`, `--font-weight-semibold: 600`,
`--font-weight-bold: 700`.

`global.css`'s `body { font-size: 14px; }` is updated to `font-size: var(--font-size-5)` as
part of this spec (one-line change, low risk, exercises the new token immediately).

### Component primitives (`frontend/src/components/ui/`)

New directory, one `.tsx` + `.module.css` pair per primitive:

**`Button.tsx`**
```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger";
}
export function Button({ variant = "default", className, ...rest }: ButtonProps) {
  const variantClass = variant !== "default" ? styles[variant] : "";
  return <button className={[styles.button, variantClass, className].filter(Boolean).join(" ")} {...rest} />;
}
```
`Button.module.css` reads the new component-layer tokens (`--button-primary-bg`, etc.),
which default to the same values `global.css`'s `.primary`/`.danger` already produce — so
`<Button variant="primary">` renders identically to today's `<button className="primary">`.
`global.css`'s existing base/`.primary`/`.danger` styles are **left in place**, not removed
— they keep serving call sites that haven't migrated yet (see Migration below).

**`Pill.tsx`**
```tsx
interface PillProps { tone?: "neutral" | "accent" | "success" | "danger"; children: React.ReactNode }
export function Pill({ tone = "neutral", children }: PillProps) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}
```
Uses `--radius-full`, `--space-1`/`--space-3` for padding. Replaces the pill styling in
`QuickPhrasesRow.module.css` and `Timeline.module.css`'s usage tags (both migrate to consume
`<Pill>` instead of their own local pill CSS).

**`Dot.tsx`**
```tsx
interface DotProps { status?: "idle" | "ok" | "bad" | "progress" }
export function Dot({ status = "idle" }: DotProps) {
  return <span className={`${styles.dot} ${styles[status]}`} />;
}
```
`progress` reuses the existing spinner animation (currently defined in
`Timeline.module.css`, moves to `Dot.module.css`). Replaces `Sidenav.tsx`'s inline
health-dot class logic and becomes what the Transcript spec's tool-call status indicator
renders.

**`Avatar.tsx`**
```tsx
interface AvatarProps { role: "user" | "assistant" }
export function Avatar({ role }: AvatarProps) {
  return <span className={`${styles.avatar} ${styles[role]}`} aria-label={role === "user" ? "You" : "Assistant"}>{role === "user" ? "Y" : "AI"}</span>;
}
```
Exactly the avatar already designed in the Transcript spec, moved here as the canonical
definition — that spec will be updated to import this instead of inlining the markup.

### Migration approach

**Incremental, not a big-bang rewrite.** This spec creates the tokens and primitives and
migrates the two direct duplicates called out above (`QuickPhrasesRow`, `Timeline` usage
tags → `Pill`; `Sidenav` health dot → `Dot`). It does **not** require migrating every
existing button/spacing value in the codebase in one pass — other files adopt `Button`,
`Pill`, `Dot`, and the spacing/type tokens as they're next touched for unrelated work,
same as any other internal refactor.

### Files to create

- `frontend/src/components/ui/Button.tsx` + `Button.module.css`
- `frontend/src/components/ui/Pill.tsx` + `Pill.module.css`
- `frontend/src/components/ui/Dot.tsx` + `Dot.module.css`
- `frontend/src/components/ui/Avatar.tsx` + `Avatar.module.css`

### Files to modify

- `frontend/src/styles/tokens.css` — add spacing scale, type scale, `--radius-full`,
  component-layer tokens.
- `frontend/src/styles/global.css` — `body` font-size uses `--font-size-5`.
- `frontend/src/components/QuickPhrasesRow.tsx` / `.module.css` — consume `<Pill>`.
- `frontend/src/components/Timeline.tsx` / `.module.css` — usage tags consume `<Pill>`.
- `frontend/src/components/Sidenav.tsx` / `.module.css` — health dot consumes `<Dot>`.

### Non-goals

- No dark/light theme switcher — the app has a single theme today; the primitive/semantic
  split is future-proofing for that, not a signal one is planned.
- No forced migration of every existing raw px value or every `className="primary"` call
  site — incremental adoption only.
- No changes to the Transcript spec's *content/behavior* — only its Avatar/Dot definitions
  move to import from `ui/` instead of being inlined, once this spec ships.

## Edge Cases

1. **Un-migrated call sites during the transition period** — `global.css`'s `.primary`/
   `.danger` classes and raw px values elsewhere keep working unchanged; nothing breaks by
   this spec landing.
2. **`Dot` `progress` status without the Transcript spec yet implemented** — `Dot` ships
   with all four states from day one (used immediately by `Sidenav`'s `idle`/`ok`/`bad`;
   `progress` has no caller until the Transcript spec lands, but is trivial to leave unused).

## Testing

- New `Button.test.tsx`, `Pill.test.tsx`, `Dot.test.tsx`, `Avatar.test.tsx` — one render
  test per variant/status/role confirming the right class/`aria-label` is applied.
- `QuickPhrasesRow.test.tsx`, `Sidenav.test.tsx` — verify existing behavior/assertions still
  pass after migrating to `Pill`/`Dot` internally (visual output unchanged, so text-content
  and interaction assertions shouldn't need edits).
- Run `cd frontend && npm run test:web`.

## Follow-up

Once this ships, update
`docs/superpowers/specs/2026-07-21-transcript-redesign-design.md` to import `Avatar` and
`Dot` from `ui/` instead of defining them inline, and to use the new spacing/type tokens
instead of the standalone `--radius-bubble` token it originally proposed.
