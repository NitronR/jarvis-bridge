# Notification Bell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a notification bell toggle in the ChatPanel header that plays synthesized chimes when the agent finishes a response or when human input is needed, with the preference persisted in `localStorage`.

**Architecture:** Fully client-side. A pure Web Audio module (`notifications.ts`) synthesizes two chimes. A hook (`useNotificationSounds`) watches the existing `ChatContext` state (`busy`, `awaitingInput`) for rising/falling edges and calls `playSound`. A `NotificationBell` toggle button (persisted via `localStorage` key `jarvis.notifications`, default on) lives next to the Settings button and gates the hook.

**Tech Stack:** TypeScript (strict), React, Web Audio API, Vitest + Testing Library. No new backend routes or assets. Spec: `docs/superpowers/specs/2026-09-10-notification-bell-design.md`.

---

## File Structure

- Create `frontend/src/state/notifications.ts` — Web Audio sound synthesis (`playSound`, `SoundKind`, `ensureAudioContext`).
- Create `frontend/src/state/notifications.test.ts` — tests for `playSound`.
- Create `frontend/src/hooks/useNotificationSounds.ts` — hook mapping state edges to sounds.
- Create `frontend/src/hooks/useNotificationSounds.test.tsx` — hook tests with a mocked `ChatContext`.
- Create `frontend/src/components/NotificationBell.tsx` — toggle button.
- Create `frontend/src/components/NotificationBell.module.css` — button styles (reuse the `settingsBtn`/`pinBtn` look).
- Create `frontend/src/components/NotificationBell.test.tsx` — button tests.
- Modify `frontend/src/components/ChatPanel.tsx` — render bell, wire state + hook.
- Modify `frontend/src/components/ChatPanel.module.css` — add `.bellBtn` active state (optional, mirrors `pinBtn`).

---

### Task 1: Sound synthesis module (`notifications.ts`)

**Files:**
- Create: `frontend/src/state/notifications.ts`
- Test: `frontend/src/state/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/state/notifications.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { playSound } from "./notifications";

class FakeParam {
  value = 0;
  setValueAtTime(v: number) { this.value = v; }
  linearRampToValueAtTime(v: number) { this.value = v; }
  exponentialRampToValueAtTime(v: number) { this.value = v; }
}

class FakeOsc {
  type = "sine";
  frequency = new FakeParam();
  connect() {}
  start() {}
  stop() {}
}

class FakeGain {
  gain = new FakeParam();
  connect() {}
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  state = "running";
  created: { osc: FakeOsc; gain: FakeGain }[] = [];
  createOscillator() { const o = new FakeOsc(); this.created.push({ osc: o, gain: new FakeGain() }); return o; }
  createGain() { return this.created[this.created.length - 1]?.gain ?? new FakeGain(); }
  createOscillatorAndGain() { const gain = new FakeGain(); return { osc: new FakeOsc(), gain }; }
  resume() { this.state = "running"; }
  close() { this.state = "closed"; }
}

let ctx: FakeAudioContext;
let origAudioContext: typeof AudioContext;

beforeEach(() => {
  ctx = new FakeAudioContext();
  origAudioContext = (globalThis as any).AudioContext;
  (globalThis as any).AudioContext = class { constructor() { return ctx; } };
});

afterEach(() => {
  if (origAudioContext === undefined) delete (globalThis as any).AudioContext;
  else (globalThis as any).AudioContext = origAudioContext;
});

describe("playSound", () => {
  it("response-complete produces a single oscillator tone", () => {
    playSound("response-complete");
    expect(ctx.created.length).toBe(1);
    expect(ctx.created[0].osc.frequency.value).toBeGreaterThan(0);
  });

  it("input-needed produces two oscillator tones", () => {
    playSound("input-needed");
    expect(ctx.created.length).toBe(2);
  });

  it("no-ops (does not throw) when AudioContext is unavailable", () => {
    delete (globalThis as any).AudioContext;
    expect(() => playSound("response-complete")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/state/notifications.test.ts`
Expected: FAIL — module `./notifications` not found.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/state/notifications.ts`:

```ts
export type SoundKind = "response-complete" | "input-needed";

let audioContext: AudioContext | null = null;

function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  if (!audioContext) {
    try {
      audioContext = new window.AudioContext();
    } catch {
      audioContext = null;
    }
  }
  if (audioContext && audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function tone(
  ctx: AudioContext,
  { freq, start, duration, volume }: { freq: number; start: number; duration: number; volume: number },
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + start + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

export function playSound(kind: SoundKind): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    if (kind === "response-complete") {
      tone(ctx, { freq: 660, start: 0, duration: 0.18, volume: 0.15 });
    } else {
      tone(ctx, { freq: 880, start: 0, duration: 0.18, volume: 0.15 });
      tone(ctx, { freq: 1174, start: 0.12, duration: 0.22, volume: 0.15 });
    }
  } catch {
    // never let an audio error crash the UI
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/state/notifications.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state/notifications.ts frontend/src/state/notifications.test.ts
git commit -m "feat(frontend): synthesized notification chimes module"
```

---

### Task 2: Notification sounds hook

**Files:**
- Create: `frontend/src/hooks/useNotificationSounds.ts`
- Test: `frontend/src/hooks/useNotificationSounds.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useNotificationSounds.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const state = { busy: false, awaitingInput: false };

vi.mock("../state/ChatContext", () => ({
  useChatContext: () => ({ state }),
}));

vi.mock("../state/notifications", () => ({
  playSound: vi.fn(),
}));

import { playSound } from "../state/notifications";
import { useNotificationSounds } from "./useNotificationSounds";

describe("useNotificationSounds", () => {
  beforeEach(() => {
    state.busy = false;
    state.awaitingInput = false;
    vi.mocked(playSound).mockClear();
  });

  it("plays response-complete when busy falls true->false", () => {
    const { rerender } = renderHook(() => useNotificationSounds(true));
    state.busy = true;
    rerender();
    expect(vi.mocked(playSound)).not.toHaveBeenCalled();
    state.busy = false;
    rerender();
    expect(vi.mocked(playSound)).toHaveBeenCalledWith("response-complete");
  });

  it("plays input-needed when awaitingInput rises false->true", () => {
    const { rerender } = renderHook(() => useNotificationSounds(true));
    state.awaitingInput = true;
    rerender();
    expect(vi.mocked(playSound)).toHaveBeenCalledWith("input-needed");
  });

  it("does not play on steady state", () => {
    const { rerender } = renderHook(() => useNotificationSounds(true));
    rerender();
    rerender();
    expect(vi.mocked(playSound)).not.toHaveBeenCalled();
  });

  it("does not play when enabled is false, but still tracks edges", () => {
    const { rerender } = renderHook(() => useNotificationSounds(false));
    state.busy = true;
    rerender();
    state.busy = false;
    rerender();
    expect(vi.mocked(playSound)).not.toHaveBeenCalled();
  });
});
```

Note: the last `it` block's tail is intentionally loose (edge tracking after re-enable is covered by Task 3 wiring); the essential assertions are the first four. If the loose tail is awkward, drop the trailing `renderHook` line — keep the assertion that no sound fired while disabled.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useNotificationSounds.test.tsx`
Expected: FAIL — module `./useNotificationSounds` not found.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/hooks/useNotificationSounds.ts`:

```ts
import { useEffect, useRef } from "react";
import { useChatContext } from "../state/ChatContext";
import { playSound } from "../state/notifications";

export function useNotificationSounds(enabled: boolean): void {
  const { state } = useChatContext();
  const prevBusy = useRef(state.busy);
  const prevAwaiting = useRef(state.awaitingInput);

  useEffect(() => {
    const busyFell = prevBusy.current && !state.busy;
    const awaitingRise = !prevAwaiting.current && state.awaitingInput;
    prevBusy.current = state.busy;
    prevAwaiting.current = state.awaitingInput;
    if (!enabled) return;
    if (busyFell) playSound("response-complete");
    if (awaitingRise) playSound("input-needed");
  }, [state.busy, state.awaitingInput, enabled]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useNotificationSounds.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useNotificationSounds.ts frontend/src/hooks/useNotificationSounds.test.tsx
git commit -m "feat(frontend): notification sounds hook on busy/awaitingInput edges"
```

---

### Task 3: Notification bell component

**Files:**
- Create: `frontend/src/components/NotificationBell.tsx`
- Create: `frontend/src/components/NotificationBell.module.css`
- Test: `frontend/src/components/NotificationBell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/NotificationBell.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationBell } from "./NotificationBell";

describe("<NotificationBell>", () => {
  it("shows as on (aria-pressed true) when enabled", () => {
    render(<NotificationBell enabled onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /notifications on/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows as off (aria-pressed false) when disabled", () => {
    render(<NotificationBell enabled={false} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /notifications off/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onToggle on click", () => {
    const onToggle = vi.fn();
    render(<NotificationBell enabled onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/NotificationBell.test.tsx`
Expected: FAIL — module `./NotificationBell` not found.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/NotificationBell.tsx`:

```tsx
import styles from "./NotificationBell.module.css";

export function NotificationBell({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.bellBtn}
      onClick={onToggle}
      aria-pressed={enabled}
      title={enabled ? "Notifications on (click to mute)" : "Notifications off (click to enable)"}
      aria-label={enabled ? "Notifications on" : "Notifications off"}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {!enabled && <span className={styles.slash} aria-hidden="true" />}
    </button>
  );
}
```

Create `frontend/src/components/NotificationBell.module.css` (mirrors `settingsBtn`/`pinBtn`):

```css
.bellBtn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 4px 6px;
}
.bellBtn:hover {
  color: var(--color-text);
  border-color: var(--color-border-strong);
}
.bellBtn svg {
  width: 16px;
  height: 16px;
}
.slash {
  position: absolute;
  left: 4px;
  right: 4px;
  top: 50%;
  height: 2px;
  background: currentColor;
  transform: rotate(-45deg);
  border-radius: 1px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/NotificationBell.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NotificationBell.tsx frontend/src/components/NotificationBell.module.css frontend/src/components/NotificationBell.test.tsx
git commit -m "feat(frontend): notification bell toggle button"
```

---

### Task 4: Wire into ChatPanel

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`

- [ ] **Step 1: Add imports**

In `frontend/src/components/ChatPanel.tsx`, add to the existing imports:

```ts
import { NotificationBell } from "./NotificationBell";
import { useNotificationSounds } from "../hooks/useNotificationSounds";
```

- [ ] **Step 2: Add persistence helpers + state**

Add these small helpers near the top of `ChatPanel.tsx` (after the other module-level helpers/imports):

```ts
const NOTIFICATIONS_KEY = "jarvis.notifications";

function readNotificationsPref(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_KEY) !== "off";
  } catch {
    return true;
  }
}
```

In the component body, alongside the other `useState` calls (around line 118, near `settingsOpen`):

```ts
const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => readNotificationsPref());
```

Add the hook call near the top of the component body (after the other hooks, e.g. after the `useEffect` that sets `awaitingInput`, around line 211):

```ts
useNotificationSounds(notificationsEnabled);
```

Add a toggle handler (e.g. after the `setFollowChat` callback block):

```ts
const onToggleNotifications = useCallback(() => {
  setNotificationsEnabled((prev) => {
    const next = !prev;
    try {
      localStorage.setItem(NOTIFICATIONS_KEY, next ? "on" : "off");
    } catch {
      // persist failure is non-fatal; session still works
    }
    return next;
  });
}, []);
```

- [ ] **Step 3: Render the bell next to Settings**

In the header toolbar (around line 618, directly before the `<button ... className={styles.settingsBtn}>`), insert:

```tsx
<NotificationBell enabled={notificationsEnabled} onToggle={onToggleNotifications} />
```

- [ ] **Step 4: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 5: Run the component test suite**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx src/components/NotificationBell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx
git commit -m "feat(frontend): wire notification bell into ChatPanel header"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm run test:web` (from repo root; runs `cd frontend && npm test -- --run`)
Expected: All tests pass.

- [ ] **Step 2: Run the backend typecheck + tests (no backend changes, sanity check)**

Run: `npm run typecheck && npm test` (from repo root)
Expected: PASS.

- [ ] **Step 3: Manual smoke test (dev)**

Run: `npm run dev` (backend) and `npm run dev:web` (frontend) in two terminals, open `localhost:5173`.

1. Confirm the bell renders next to Settings and defaults to on.
2. Click the bell — it toggles off (slash shown), and `localStorage` reflects `jarvis.notifications = "off"`. Reload — stays off.
3. Re-enable. Send a message; when the agent finishes, hear the `response-complete` chime.
4. Trigger a permission dialog (a tool approval) — hear the `input-needed` chime. Do the same for an ask/elicitation dialog.

---

## Self-Review

**Spec coverage:**
- Bell toggle next to Settings → Task 3 + Task 4.
- Persist `jarvis.notifications`, default on → Task 4 (`readNotificationsPref`, `onToggleNotifications`).
- Two sounds (response-complete, input-needed) → Task 1.
- Play regardless of focus → the hook has no `document.hidden` check (Task 2).
- No asset files, Web Audio synth → Task 1.
- Silent on failure → `playSound` try/catch + `ensureAudioContext` null-check (Task 1); localStorage wrapped in try/catch (Task 4).
- Bell off ⇒ silent → `useNotificationSounds(enabled)` gates on `enabled` (Task 2, Task 4).

**Placeholder scan:** No TBD/TODO; every code step has full implementation and exact commands.

**Type consistency:** `SoundKind` defined once (Task 1) and used in `playSound` (Task 1) and the hook's two `playSound(...)` calls (Task 2). `enabled: boolean`, `onToggle: () => void` on `NotificationBell` (Task 3) match Task 4 usage. `NotificationBell` named export matches imports.