# Frontend Redesign: Quiet Signal — Design Spec

Date: 2026-07-13
Status: Draft, pending review

## Context

The current frontend (`frontend/src/`) uses a generic dark-dev-tool theme: near-black
background (`#11161b`), GitHub-style blue accent (`#4ea3ff`), system sans font, 2-6px
border radii. It works but reads as templated — the kind of default any AI-assisted dev
tool ends up with unless someone makes deliberate choices.

A prior, more ambitious redesign attempt exists on branch `feat/phase5-hud-v2` (Three.js
holographic sphere, GSAP boot sequence, arc reactor, WebAudio sound design) but was never
merged into `main`. Per explicit decision during brainstorming, this effort does **not**
resume that branch — it's a fresh direction, informed by why that one likely stalled
(large surface area, high engineering cost relative to what shipped).

## Goals

- Redesign the entire frontend (Sidenav, ChatPanel and its children, TerminalDrawer,
  Status/Settings/Skills panels) in one cohesive pass, sharing a single token system.
- Distinctive, portfolio-quality visual identity — not a generic dark-mode SaaS default,
  not a repeat of the shelved HUD branch's scope/complexity.
- Ground the identity in what the app actually is: a live relay ("bridge") between the
  user and a coding agent — chat, live tool calls, a real embedded terminal.

## Non-goals

- No resumption or reconciliation of `feat/phase5-hud-v2`.
- No new backend/data plumbing — all visual/interaction changes are client-side, driven
  by state already available via `ChatContext`/`useChat` and the existing `ChatPatch`
  stream.
- No permanent live-telemetry dashboard (rejected in favor of a calmer approach — see
  "Signature element" below).

## Color

Dark-neutral graphite base (intentionally not blue-tinted GitHub-dark) with an amber
"signal" accent reserved for live-activity meaning, and a separate muted teal for
ordinary interactive elements so the amber doesn't get diluted into generic UI chrome:

| Token | Hex | Role |
|---|---|---|
| `--color-bg` | `#13161a` | app background |
| `--color-surface-1` | `#1b1f25` | panels, cards |
| `--color-surface-2` | `#242a31` | raised surfaces (modals, composer, hover) |
| `--color-surface-3` | `#2b323a` | further-raised (switches, tags) |
| `--color-border` | `#2d343c` | hairlines |
| `--color-border-strong` | `#3d454f` | emphasized hairlines, hover borders |
| `--color-text` | `#e7e9ec` | primary text |
| `--color-text-muted` | `#8b9198` | secondary text |
| `--color-text-dim` | `#5e646b` | tertiary / labels |
| `--color-signal` | `#ffb454` | live-activity amber (health dot, responding indicators) |
| `--color-accent` | `#6fb7c9` | ordinary interactive — buttons, links, focus rings |
| `--color-accent-strong` | `#8fcbda` | interactive hover/emphasis |
| `--color-success` | `#6bbf8a` | muted green |
| `--color-danger` | `#e0685a` | muted coral-red (also used for the Stop action) |

## Typography

Three-role pairing, avoiding both the generic Inter-everywhere default and the
cream+serif cliché:

- **Display** — `Space Grotesk` (500/600/700). Session titles, nav group labels,
  eyebrows. Used with restraint, not for body copy.
- **Body** — `IBM Plex Sans` (400/500/600). Chat prose, UI copy, buttons.
- **Mono/utility** — `IBM Plex Mono` (400/500/600). Code blocks, tool call args/results,
  timestamps, token-usage figures, **and the embedded terminal** (`TerminalDrawer`'s
  xterm instance) — using the same mono family in the real terminal ties it visually
  into the same system instead of feeling bolted on.

Loaded via Google Fonts (`Space+Grotesk`, `IBM+Plex+Sans`, `IBM+Plex+Mono`).

## Layout

### Sidenav
Unchanged structurally (brand + Workspace/Admin nav groups). Visual updates only:
- `HealthDot` re-themed to use `--color-signal` with a pulse animation when
  connected/active, muted red-toned when down — folding it into the same "signal"
  language rather than being a generic colored dot.
- Active nav tab gets a left accent border (signal amber) instead of a filled
  background-only state.

### ChatPanel — header
Unchanged button set except: **Steer is removed from the header.** See "Composer
responding-state actions" below — steering only makes sense while the agent is busy, so
it's relocated to be contextual rather than a persistent header toggle.

Remaining header buttons: Info, Chats, +New, Fork, AA.

### ChatPanel — transcript
Re-typeset with the new token system. User messages get a left accent border + `>`
prefix (mono), assistant text uses the body face, tool calls remain `<details>` cards
(matching current `Timeline.tsx` structure) re-styled with the new surface/border
tokens and a signal-amber glyph marker. Token usage row moves to mono utility styling.
No structural changes to `Timeline.tsx`'s patch-parsing logic — this is a re-skin, not a
data-flow change.

### ChatPanel — composer responding-state actions

This is the one interaction change beyond a re-skin, validated in the HTML prototype:

- **At rest** (agent idle): composer shows the textarea and a single **Send** button,
  same as today.
- **While the agent is responding** (streaming or running a tool call — i.e. `chat.busy`
  in the real app): the Send button slot is replaced *inline, in the same row, at the
  same position* by three buttons: **Queue**, **Stop**, **Steer**. There is no separate
  row or banner — the swap happens right at the edge of the input field.
  - **Queue** — maps to the existing `onQueue` handler (queues text for after the
    current turn; today surfaced via a toast, "Queued for after current turn").
  - **Stop** — maps to the existing cancel path (`chat.cancel()`).
  - **Steer** — maps to the existing `onSteerComposer`/`onToggleSteer` handlers,
    gated the same way it is today by `ctx.state.capabilities?.steer`.
- No new capabilities are introduced; this only relocates and re-contextualizes buttons
  that already exist in `ChatPanelInner` (`onQueue`, `chat.cancel`, `onSteerComposer`,
  `onToggleSteer`) plus the header's old Steer toggle.

### InfoPanel
Unchanged fields (model, cwd, group, pinned, auto-approve), re-styled with the new
token system and mono labels for data values (cwd, model id).

### TerminalDrawer
Currently hardcodes `theme: { background: "#001020" }` in the xterm `Terminal`
constructor and uses inline styles throughout instead of a CSS module. This redesign:
- Re-themes xterm's `theme` config from the token system (background → `--color-bg` or
  `--color-surface-1`, foreground → `--color-text`, cursor → `--color-signal`).
- Moves the component's inline styles into `TerminalDrawer.module.css`, matching the
  pattern used by every other component (`*.module.css` + `styles` import).
- No behavioral change to the WebSocket/xterm wiring.

### Status / Settings / Skills panels
Inherit the token system, type scale, and button/form styling for consistency. No
layout restructuring — these are lower-traffic surfaces and get a re-skin, not a
redesign.

## Signature element — deferred

Approach A ("Quiet Signal") originally proposed a live waveform strip ("Signal Line")
at the seam between transcript and composer, animated from the real `ChatPatch` stream,
as the page's one distinctive/memorable element. This was prototyped (canvas-based,
idle/streaming/tool-call states) but **removed from scope for now** at the user's
request — it added visual complexity without yet being validated as worth it.

Current state: the design has no signature element. Color, type, and the
queue/stop/steer composer pattern carry the identity for now. This is an explicit open
question, not a decision to skip a signature permanently — worth revisiting once the
rest of the redesign has shipped and there's a feel for whether the app needs one.

## Cross-cutting technical notes

- `frontend/src/styles/tokens.css` is rewritten wholesale as the single source of
  truth; every component already consumes CSS custom properties, so this cascades
  without per-component color hunting.
- Motion (health-dot pulse, any future signature element) must respect
  `prefers-reduced-motion` — reduced-motion mode drops to static/stepped states instead
  of continuous animation.
- `tsc --noEmit` and the existing Vitest suite (`npm run test:web`) must keep passing.
  Visual verification happens by running `npm run dev:web` and checking in-browser —
  type-checking and unit tests confirm correctness, not visual/interaction correctness.
- `TerminalDrawer`'s move from inline styles to a CSS module is a pre-existing
  code-quality gap this redesign fixes in passing (not scope creep — it's the same file
  already being touched for the retheme).

## Implementation stages

1. Token system rewrite (`tokens.css`, `global.css`).
2. Sidenav + shell chrome (health dot, nav tabs).
3. ChatPanel: header (Steer removal), transcript re-skin, InfoPanel re-skin, composer
   responding-state action swap (Queue/Stop/Steer).
4. TerminalDrawer retheme + inline-style-to-module cleanup.
5. Status/Settings/Skills panels re-skin.
6. Copy pass on button labels / empty states per the frontend-design skill's writing
   guidance (active voice, consistent verb-to-toast vocabulary).

## Open questions

- Does the design need a signature element after all, and if so, what (see "Signature
  element — deferred" above)? Revisit post-ship.
- Should `--color-danger` styling on Stop be reconsidered once seen in the full app —
  the prototype uses a danger-red outline to differentiate it from Queue/Steer, but this
  wasn't explicitly reviewed in isolation.
