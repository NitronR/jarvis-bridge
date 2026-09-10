# Design: Notification Bell — Sound Alerts on Agent State Changes

Date: 2026-09-10
Status: Draft for review

## Summary

Add a notification bell toggle button next to the Settings button in the ChatPanel
header. When enabled (default on), it plays a short synthesized chime when the agent
finishes responding, and a distinct chime when human input is needed (a permission
dialog or an ask/elicitation dialog opens). Sounds play regardless of whether the
window or tab is focused. The on/off preference persists in `localStorage`.

## Context & Motivation

The frontend already signals "the agent needs me" and "the agent is busy" through the
chat state, and changes the browser favicon accordingly (`useFavicon.ts`). But those are
silent. When the user is on another tab or away from the window, they have no audible cue
that (a) a long-running agent turn has finished or (b) an action is required of them. This
feature adds optional audio notifications.

Existing signals reused (no new backend events or routes):

- `busy` (`ChatContext.state.busy`) — true while the agent is streaming a turn.
- `awaitingInput` (`ChatContext.state.awaitingInput`) — true while a permission dialog
  (`ApprovalModal`) or ask dialog (`ElicitationModal`) is open. It is set together for both
  in `ChatPanel.tsx` (`setAwaitingInput(pendingApproval !== null || pendingElicitation !== null)`).

## Requirements

1. **Bell toggle** in the ChatPanel header, adjacent to the Settings button. Reflects on/off
   and is clickable to toggle.
2. **Persistent preference**: stored in `localStorage` under key `jarvis.notifications`.
   Default is **on**. Read on mount; write on change.
3. **Two sounds** (decision B):
   - `response-complete`: plays when `busy` transitions `true → false`.
   - `input-needed`: plays when `awaitingInput` transitions `false → true` (covers both the
     permission dialog and the ask dialog, which share the `awaitingInput` signal).
4. **Play regardless of focus** (decision): no `document.hidden` / focus gating. Sounds fire
   on every qualifying rising/falling edge while the bell is on.
5. **No audio asset files**: sounds are synthesized with the Web Audio API (oscillator chimes),
   so nothing new is bundled and the vite/npx build story is unchanged.
6. **Silent on failure**: Web Audio is wrapped in try/catch. If `AudioContext` is unavailable
   (old browser, SSR, test environment), the hook no-ops instead of throwing.
7. **Bell off ⇒ silent**: when the toggle is off, no sounds play; the state is still derived
   (we can keep deriving) but `playSound` is not called.

## Non-goals

- No new backend HTTP route, WebSocket event, or token type (notification is purely client-side).
- No per-trigger sound selection UI, volume control, or preview. Out of scope for this change.
- No focus-aware throttling (play regardless of focus per decision).
- No change to the existing favicon behavior.

## Architecture

Fully client-side. Three new modules plus a small wiring change in `ChatPanel.tsx`:

```
frontend/src/
  components/
    NotificationBell.tsx        # toggle button + CSS module
    NotificationBell.module.css
  hooks/
    useNotificationSounds.ts    # watches ChatContext, maps edges -> playSound
  state/
    notifications.ts            # playSound(kind), chime generation via Web Audio (no component deps)
```

### notifications.ts (sound synthesis)

Pure Web Audio module. Exposes:

```ts
export type SoundKind = "response-complete" | "input-needed";
export function playSound(kind: SoundKind): void;
```

`playSound` creates an `AudioContext` (lazily, singleton) and plays a short chime:
- `response-complete`: a single soft sine tone (~660 Hz), brief (~150 ms).
- `input-needed`: two tones (e.g. ~880 Hz then ~1174 Hz), slightly more insistent, ~350 ms total.

Wrapped in try/catch; no-ops if `AudioContext` is unavailable. The `AudioContext` constructor
and the tone params are the only assumptions, making it trivially mockable in tests.

### useNotificationSounds.ts (edge → sound)

```ts
export function useNotificationSounds(enabled: boolean): void;
```

Reads `busy` and `awaitingInput` from `useChatContext()`. Tracks the previous values in refs.
On each render, compares current vs previous:
- `busy` prev `true`, now `false` → if enabled, `playSound("response-complete")`.
- `awaitingInput` prev `false`, now `true` → if enabled, `playSound("input-needed")`.

Update the refs unconditionally (regardless of `enabled`) so edges aren't missed when the
bell is toggled. Only the `playSound` calls are gated on `enabled`.

Edge semantics verified by design: both `busy` and `awaitingInput` are set only at their true
transition points and reset on completion, so a rising/falling edge corresponds to a single
logical event. (Confirmed against `useFavicon.ts` which consumes the same three flags.)

### NotificationBell.tsx

A button with a bell SVG, styled to match the existing `settingsBtn` in `ChatPanel.module.css`.
Props: `{ enabled: boolean; onToggle: () => void }`. Renders an on/off visual state (e.g. muted
bell or strikethrough) and `aria-pressed`/`aria-label` for accessibility. No local persistence
logic — `ChatPanel` owns the state so it can also pass `enabled` to the hook.

### ChatPanel.tsx wiring

- Add `const [notificationsEnabled, setNotificationsEnabled] = useState(() => readNotificationsPref())`.
- Render `<NotificationBell enabled={notificationsEnabled} onToggle={...} />` beside the Settings
  button (`ChatPanel.tsx:618` region).
- Call `useNotificationSounds(notificationsEnabled)`.
- On toggle, write the new value to `localStorage` under `jarvis.notifications` and update state.

## Data flow

```
toggle click ──> setNotificationsEnabled(v) ──> localStorage["jarvis.notifications"] = v
                                                    └────────> useNotificationSounds(v)
agent busy ──> ChatContext.state.busy (true→false) ──> hook sees falling edge ──> playSound("response-complete")
dialog opens ──> ChatContext.state.awaitingInput (false→true) ──> hook sees rising edge ──> playSound("input-needed")
```

## Persistence

- Key: `jarvis.notifications`, stored as the string `"on"` or `"off"`. Defaults to `"on"` when the
  key is absent.
- Read once at `ChatPanel` mount (`useState` initializer) so the initial render matches the saved
  preference; write on every toggle. Mirrors the existing `jarvis.lastChatsTab` localStorage usage.

## Error handling

- `playSound` wraps all Web Audio construction/playback in try/catch. Unsupported environments
  produce no sound and no error.
- `localStorage` access is wrapped in try/catch (guards against storage-disabled browsers); on
  failure, the toggle still works for the session but does not persist.

## Testing

- `frontend/src/state/notifications.test.ts`: mock a global `AudioContext`; assert `playSound`
  constructs tones for each kind; assert it no-ops (no throw) when `AudioContext` is absent.
- `frontend/src/hooks/useNotificationSounds.test.tsx`: render the hook inside a
  `ChatContextProvider` with a controllable state (or a mock context); flip `busy`/`awaitingInput`
  and assert the expected `playSound` calls. Assert no call on steady state, on the wrong edge,
  or when `enabled` is false.
- `frontend/src/components/NotificationBell.test.tsx`: assert the toggle reflects the `enabled`
  prop, calls `onToggle`, and exposes the right `aria-pressed`/label.

Run with `cd frontend && npx vitest run <file>` and the full suite `npm run test:web` (from repo root).

## Risks & mitigations

- **Browsers blocking audio before user gesture**: `AudioContext` may start suspended. Since the
  bell is default-on and the user clicks the bell at least once to configure it, the first click
  can resume the context. Mitigation: in the bell's onToggle (or first render), call
  `resume()` on the shared context. This is a known browser autoplay policy; acceptable for a
  local tool.
- **Double-beep edge**: if a dialog opens while a turn is finishing, `busy` falling and
  `awaitingInput` rising can both fire. That is acceptable (two events, two sounds); no
  dedup added.

## File changes

New:
- `frontend/src/components/NotificationBell.tsx`
- `frontend/src/components/NotificationBell.module.css`
- `frontend/src/hooks/useNotificationSounds.ts`
- `frontend/src/state/notifications.ts`
- `frontend/src/state/notifications.test.ts`
- `frontend/src/hooks/useNotificationSounds.test.tsx`
- `frontend/src/components/NotificationBell.test.tsx`

Modified:
- `frontend/src/components/ChatPanel.tsx` (bell + hook wiring, `notificationsEnabled` state)
- `frontend/src/components/ChatPanel.module.css` (any shared header-button styling, if needed)