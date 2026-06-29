# Phase 5 — JARVIS HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repaint the Phase 4 behavioral frontend into a JARVIS HUD design system — new palette, chrome, holographic canvas, boot animation, sound — without changing any application logic.

**Architecture:** Token-driven repaint (same CSS custom property names, new JARVIS values) + additive chrome components (corner brackets, top strip, bottom ticker, scanline, arc reactor, holographic canvas). All implemented as React components/hooks within the Vite pipeline. Three.js (already installed) for hologram, GSAP (to install) for boot animation, WebAudio API for sound.

**Tech Stack:** React 18, TypeScript, Vite, Three.js 0.169, GSAP 3.12, CSS custom properties, Web Audio API

## Global Constraints

- **Zero behavior changes.** Phase 4 flows (chat, fork, steer, approve, terminal, skills) must remain intact.
- **All chrome is `aria-hidden="true"`** and out of the tab order — purely decorative.
- **`prefers-reduced-motion`** must disable all animation: boot skip, scanline freeze, ticker freeze, holo static frame, no tab dissolve, no glitch.
- **Token names are immutable.** Only values change. Downstream CSS recolors automatically.
- **No CDN script tags.** All dependencies via npm, tree-shaken by Vite.
- **Graceful degradation.** Every effect no-ops if its dependency fails.
- **Kill switches.** `hud:holo=off` and `hud:sound=off` in localStorage.

---

### Task 1: Install GSAP + Design Token Rewrite + Body Background

**Files:**
- Modify: `frontend/package.json` (add gsap dependency)
- Modify: `frontend/src/styles/tokens.css` (rewrite all values)
- Modify: `frontend/src/styles/global.css` (body background + grid overlay)
- Modify: `frontend/index.html` (Google Fonts links)

**Interfaces:**
- Consumes: nothing
- Produces: JARVIS design tokens available globally via CSS custom properties. All existing components recolor automatically.

- [ ] **Step 1: Install gsap**

```bash
cd frontend && npm install gsap@^3.12.5
```

Expected: package.json updated, `node_modules/gsap` exists.

- [ ] **Step 2: Add Google Fonts to index.html**

In `frontend/index.html`, add inside `<head>` before the closing `</head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Rewrite tokens.css to JARVIS palette**

Replace the entire contents of `frontend/src/styles/tokens.css` with:

```css
:root {
  --color-bg: #02060a;
  --color-surface-1: rgba(91, 233, 255, 0.04);
  --color-surface-2: rgba(91, 233, 255, 0.06);
  --color-surface-3: rgba(91, 233, 255, 0.08);
  --color-text: #d8f5ff;
  --color-text-muted: rgba(216, 245, 255, 0.7);
  --color-border: rgba(91, 233, 255, 0.25);
  --color-border-strong: #5be9ff;
  --color-accent: #5be9ff;
  --color-accent-strong: #5be9ff;
  --color-accent-tint: rgba(91, 233, 255, 0.18);
  --color-success: #5be9ff;
  --color-warning: #ffb84a;
  --color-danger: #ff3b3b;

  --font-sans: 'Orbitron', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --radius-sm: 0;
  --radius-md: 2px;
  --radius-lg: 2px;

  --shadow-md: 0 0 14px rgba(91, 233, 255, 0.35);

  --sidenav-w: 220px;
  --chat-composer-h: 96px;
  --header-h: 44px;

  /* HUD-specific tokens */
  --hud-strip-h: 28px;
  --hud-glow: 0 0 14px rgba(91, 233, 255, 0.35);
  --hud-glow-strong: 0 0 20px rgba(91, 233, 255, 0.5);
  --color-cyan: #5be9ff;
  --color-amber: #ffb84a;
}
```

- [ ] **Step 4: Update global.css body background + grid overlay**

In `frontend/src/styles/global.css`, replace the `body` block with:

```css
body {
  background:
    radial-gradient(ellipse at 50% 0%, rgba(91, 233, 255, 0.06) 0%, transparent 60%),
    var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
}

body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(rgba(91, 233, 255, 0.15) 1px, transparent 1px);
  background-size: 20px 20px;
  z-index: 0;
  opacity: 0.3;
}
```

- [ ] **Step 5: Verify build succeeds**

```bash
cd frontend && npx tsc --noEmit && npx vite build
```

Expected: No type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(hud): rewrite design tokens to JARVIS palette, add GSAP + Google Fonts"
```

---

### Task 2: useReducedMotion Hook + HUD State Context

**Files:**
- Create: `frontend/src/hud/hooks/useReducedMotion.ts`
- Create: `frontend/src/hud/HudStateContext.tsx`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `useReducedMotion(): boolean` — returns `true` when `prefers-reduced-motion: reduce` is active
  - `HudStateProvider` — wraps the app; exposes agent state to HUD components outside the ChatPanel
  - `useHudState(): HudState` — `{ agentStatus, streaming, error, sessionId, usage }`
  - `useHudDispatch(): HudDispatch` — `{ setStreaming, setError, setSessionId, setUsage }`

- [ ] **Step 1: Create useReducedMotion hook**

Create `frontend/src/hud/hooks/useReducedMotion.ts`:

```ts
import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
```

- [ ] **Step 2: Create HudStateContext**

Create `frontend/src/hud/HudStateContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type AgentStatus = "healthy" | "degraded" | "unreachable" | "unknown";

export interface HudState {
  agentStatus: AgentStatus;
  streaming: boolean;
  error: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  activePanel: string;
}

export interface HudDispatch {
  setAgentStatus: (s: AgentStatus) => void;
  setStreaming: (b: boolean) => void;
  setError: (e: string | null) => void;
  setSessionId: (id: string | null) => void;
  setUsage: (input: number, output: number) => void;
  setActivePanel: (panel: string) => void;
}

const INITIAL: HudState = {
  agentStatus: "unknown",
  streaming: false,
  error: null,
  sessionId: null,
  inputTokens: 0,
  outputTokens: 0,
  activePanel: "chat",
};

const StateCtx = createContext<HudState>(INITIAL);
const DispatchCtx = createContext<HudDispatch | null>(null);

export function HudStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HudState>(INITIAL);

  const setAgentStatus = useCallback((s: AgentStatus) => setState((p) => ({ ...p, agentStatus: s })), []);
  const setStreaming = useCallback((b: boolean) => setState((p) => ({ ...p, streaming: b })), []);
  const setError = useCallback((e: string | null) => setState((p) => ({ ...p, error: e })), []);
  const setSessionId = useCallback((id: string | null) => setState((p) => ({ ...p, sessionId: id })), []);
  const setUsage = useCallback((input: number, output: number) =>
    setState((p) => ({ ...p, inputTokens: input, outputTokens: output })), []);
  const setActivePanel = useCallback((panel: string) => setState((p) => ({ ...p, activePanel: panel })), []);

  const dispatch = useMemo<HudDispatch>(
    () => ({ setAgentStatus, setStreaming, setError, setSessionId, setUsage, setActivePanel }),
    [setAgentStatus, setStreaming, setError, setSessionId, setUsage, setActivePanel],
  );

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useHudState(): HudState {
  return useContext(StateCtx);
}

export function useHudDispatch(): HudDispatch {
  const d = useContext(DispatchCtx);
  if (!d) throw new Error("useHudDispatch must be inside HudStateProvider");
  return d;
}
```

- [ ] **Step 3: Verify types compile**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(hud): add useReducedMotion hook and HudStateContext"
```

---

### Task 3: HUD Chrome — ViewportFrame + TopStrip + BottomTicker + Scanline + hud.css

**Files:**
- Create: `frontend/src/hud/styles/hud.css`
- Create: `frontend/src/hud/HudViewportFrame.tsx`
- Create: `frontend/src/hud/hooks/useClock.ts`
- Create: `frontend/src/hud/hooks/useAgentHealth.ts`
- Create: `frontend/src/hud/HudTopStrip.tsx`
- Create: `frontend/src/hud/utils/ticker-data.ts`
- Create: `frontend/src/hud/HudBottomTicker.tsx`
- Create: `frontend/src/hud/HudScanline.tsx`

**Interfaces:**
- Consumes: `useReducedMotion()`, `useHudState()`, `useHudDispatch()`, CSS tokens
- Produces:
  - `<HudViewportFrame />` — four corner bracket SVGs
  - `<HudTopStrip />` — clock, agent dot, coords, sound toggle, brand
  - `<HudBottomTicker />` — scrolling hex data stream
  - `<HudScanline />` — drifting horizontal line
  - `useClock(): string` — returns `HH:MM:SS` UTC string, updates every second
  - `useAgentHealth(): AgentStatus` — polls `/health/agent`, returns tri-state

- [ ] **Step 1: Create hud.css with all chrome styles and keyframes**

Create `frontend/src/hud/styles/hud.css`:

```css
/* ─── HUD viewport frame: corner brackets ─── */
.hud-viewport-frame {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
}
.hud-corner {
  position: absolute;
  width: 24px;
  height: 24px;
}
.hud-corner svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 4px var(--color-accent));
}
.hud-corner--tl { top: 4px; left: 4px; }
.hud-corner--tr { top: 4px; right: 4px; transform: scaleX(-1); }
.hud-corner--bl { bottom: 4px; left: 4px; transform: scaleY(-1); }
.hud-corner--br { bottom: 4px; right: 4px; transform: scale(-1); }

/* ─── HUD top strip ─── */
.hud-top-strip {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--hud-strip-h);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  font-family: var(--font-sans);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  background: rgba(2, 6, 10, 0.85);
  backdrop-filter: blur(4px);
  z-index: 9998;
  box-shadow: var(--hud-glow);
}
.hud-sep {
  width: 1px;
  height: 14px;
  background: var(--color-border);
}
.hud-spacer { flex: 1; }
.hud-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-muted);
  transition: background 0.3s;
}
.hud-dot--healthy { background: var(--color-cyan); box-shadow: 0 0 6px var(--color-cyan); }
.hud-dot--degraded { background: var(--color-amber); box-shadow: 0 0 6px var(--color-amber); }
.hud-dot--unreachable { background: var(--color-danger); box-shadow: 0 0 6px var(--color-danger); }
.hud-time { color: var(--color-cyan); font-weight: 600; font-variant-numeric: tabular-nums; }
.hud-id { color: var(--color-accent); font-weight: 600; }
.hud-sound-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
  line-height: 1;
}
.hud-sound-btn:hover { color: var(--color-accent); }

/* ─── HUD bottom ticker ─── */
.hud-bottom-ticker {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--hud-strip-h);
  overflow: hidden;
  border-top: 1px solid var(--color-border);
  background: rgba(2, 6, 10, 0.85);
  backdrop-filter: blur(4px);
  z-index: 9998;
}
.hud-ticker-track {
  display: flex;
  align-items: center;
  height: 100%;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
  opacity: 0.6;
  gap: 16px;
  padding: 0 16px;
  animation: ticker-scroll 60s linear infinite;
}
.hud-ticker-sep {
  color: var(--color-accent);
  opacity: 0.4;
}

/* ─── HUD scanline ─── */
.hud-scanline {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--color-accent) 50%, transparent 100%);
  opacity: 0.15;
  pointer-events: none;
  z-index: 10;
  animation: scanline-sweep 8s linear infinite;
}

/* ─── Utility: glow ─── */
.glow {
  box-shadow: var(--hud-glow);
  filter: drop-shadow(0 0 6px rgba(91, 233, 255, 0.3));
}

/* ─── Utility: bracket-frame ─── */
.bracket-frame {
  position: relative;
}
.bracket-frame::before,
.bracket-frame::after {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  border-color: var(--color-accent);
  border-style: solid;
  pointer-events: none;
  opacity: 0.5;
}
.bracket-frame::before {
  top: -2px;
  left: -2px;
  border-width: 1px 0 0 1px;
}
.bracket-frame::after {
  bottom: -2px;
  right: -2px;
  border-width: 0 1px 1px 0;
}

/* ─── Keyframes ─── */
@keyframes scanline-sweep {
  0% { top: -2px; }
  100% { top: 100%; }
}

@keyframes ticker-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

@keyframes boot-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes boot-rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes dust-out {
  to { opacity: 0; filter: blur(4px); transform: scale(0.98); }
}

@keyframes dust-in {
  from { opacity: 0; filter: blur(4px); transform: scale(1.02); }
  to { opacity: 1; filter: none; transform: scale(1); }
}

@keyframes glitch {
  0%, 100% { transform: translate(0); filter: none; }
  20% { transform: translate(-2px, 1px); filter: hue-rotate(90deg); }
  40% { transform: translate(2px, -1px); filter: hue-rotate(-90deg); }
  60% { transform: translate(-1px, -2px); }
  80% { transform: translate(1px, 2px); }
}

@keyframes ring-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ─── Reduced motion ─── */
@media (prefers-reduced-motion: reduce) {
  .hud-scanline,
  .hud-ticker-track {
    animation: none !important;
  }
  .hud-scanline { display: none; }
}
```

- [ ] **Step 2: Create useClock hook**

Create `frontend/src/hud/hooks/useClock.ts`:

```ts
import { useEffect, useState } from "react";

function utcTime(): string {
  const d = new Date();
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function useClock(): string {
  const [time, setTime] = useState(utcTime);

  useEffect(() => {
    const id = setInterval(() => setTime(utcTime()), 1000);
    return () => clearInterval(id);
  }, []);

  return time;
}
```

- [ ] **Step 3: Create useAgentHealth hook**

Create `frontend/src/hud/hooks/useAgentHealth.ts`:

```ts
import { useEffect, useRef } from "react";
import type { AgentStatus } from "../HudStateContext";
import { useHudDispatch } from "../HudStateContext";

export function useAgentHealth(intervalMs = 10_000): void {
  const dispatch = useHudDispatch();
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch("/health");
        if (!r.ok) {
          dispatch.setAgentStatus("degraded");
          return;
        }
        const data = await r.json();
        const status: AgentStatus = data.agent === false ? "degraded" : "healthy";
        dispatch.setAgentStatus(status);
      } catch {
        dispatch.setAgentStatus("unreachable");
      }
    };
    poll();
    timer.current = setInterval(poll, intervalMs);
    return () => clearInterval(timer.current);
  }, [dispatch, intervalMs]);
}
```

- [ ] **Step 4: Create HudViewportFrame**

Create `frontend/src/hud/HudViewportFrame.tsx`:

```tsx
import "./styles/hud.css";

const cornerPath = "M 0 16 L 0 0 L 16 0";

function Corner({ className }: { className: string }) {
  return (
    <div className={`hud-corner ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d={cornerPath} stroke="var(--color-accent)" strokeWidth="1" fill="none" />
      </svg>
    </div>
  );
}

export function HudViewportFrame() {
  return (
    <div className="hud-viewport-frame" aria-hidden="true">
      <Corner className="hud-corner--tl" />
      <Corner className="hud-corner--tr" />
      <Corner className="hud-corner--bl" />
      <Corner className="hud-corner--br" />
    </div>
  );
}
```

- [ ] **Step 5: Create HudTopStrip**

Create `frontend/src/hud/HudTopStrip.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useClock } from "./hooks/useClock";
import { useAgentHealth } from "./hooks/useAgentHealth";
import { useHudState } from "./HudStateContext";
import "./styles/hud.css";

// Deterministic pseudo-random coordinate cycling
const COORDS = [
  "LAT 40.7128° LON -74.0060°",
  "LAT 37.7749° LON -122.4194°",
  "LAT 34.0522° LON -118.2437°",
  "LAT 51.5074° LON -0.1278°",
  "LAT 48.8566° LON 2.3522°",
  "LAT 35.6762° LON 139.6503°",
];

export function HudTopStrip() {
  const time = useClock();
  useAgentHealth();
  const { agentStatus, sessionId, inputTokens, outputTokens } = useHudState();
  const [coordIdx, setCoordIdx] = useState(0);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("hud:sound") !== "off");

  useEffect(() => {
    const id = setInterval(() => setCoordIdx((i) => (i + 1) % COORDS.length), 5000);
    return () => clearInterval(id);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      localStorage.setItem("hud:sound", next ? "on" : "off");
      window.dispatchEvent(new CustomEvent("hud:sound-toggle", { detail: { on: next } }));
      return next;
    });
  }, []);

  const dotClass = `hud-dot hud-dot--${agentStatus}`;

  return (
    <div className="hud-top-strip" aria-hidden="true">
      <span className="hud-time">{time}</span>
      <span className="hud-sep" />
      <span>AGENT <span className={dotClass} /></span>
      <span className="hud-sep" />
      <span>{COORDS[coordIdx]}</span>
      {sessionId && (
        <>
          <span className="hud-sep" />
          <span>SID:{sessionId.slice(0, 8)}</span>
        </>
      )}
      {(inputTokens > 0 || outputTokens > 0) && (
        <>
          <span className="hud-sep" />
          <span>TKN:{inputTokens + outputTokens}</span>
        </>
      )}
      <span className="hud-spacer" />
      <button
        type="button"
        className="hud-sound-btn"
        onClick={toggleSound}
        title={soundOn ? "Mute HUD sounds" : "Enable HUD sounds"}
      >
        {soundOn ? "🔊" : "🔇"}
      </button>
      <span className="hud-sep" />
      <span className="hud-id">JARVIS BRIDGE // MK-I</span>
    </div>
  );
}
```

- [ ] **Step 6: Create ticker-data utility**

Create `frontend/src/hud/utils/ticker-data.ts`:

```ts
const HEX_CHARS = "0123456789ABCDEF";

function randomHex(length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += HEX_CHARS[Math.floor(Math.random() * 16)];
  }
  return result;
}

function randomBinary(length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += Math.random() > 0.5 ? "1" : "0";
  }
  return result;
}

export interface TickerSegment {
  text: string;
  type: "hex" | "binary" | "signal";
}

export function generateTickerSegments(
  sessionId: string | null,
  panel: string,
  tokenCount: number,
  count = 20,
): TickerSegment[] {
  const segments: TickerSegment[] = [];
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    if (roll < 0.4) {
      segments.push({ text: `${randomHex(2)} ${randomHex(2)} ${randomHex(2)}`, type: "hex" });
    } else if (roll < 0.65) {
      segments.push({ text: randomBinary(8), type: "binary" });
    } else if (roll < 0.75 && sessionId) {
      segments.push({ text: `session:${sessionId.slice(0, 6)}`, type: "signal" });
    } else if (roll < 0.85 && tokenCount > 0) {
      segments.push({ text: `tokens:${tokenCount.toLocaleString()}`, type: "signal" });
    } else if (roll < 0.95) {
      segments.push({ text: `panel:${panel}`, type: "signal" });
    } else {
      segments.push({ text: `${randomHex(4)}`, type: "hex" });
    }
  }
  return segments;
}
```

- [ ] **Step 7: Create HudBottomTicker**

Create `frontend/src/hud/HudBottomTicker.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useHudState } from "./HudStateContext";
import { generateTickerSegments, type TickerSegment } from "./utils/ticker-data";
import "./styles/hud.css";

export function HudBottomTicker() {
  const { sessionId, activePanel, inputTokens, outputTokens } = useHudState();
  const [segments, setSegments] = useState<TickerSegment[]>([]);
  const frameRef = useRef(0);

  useEffect(() => {
    const initial = generateTickerSegments(sessionId, activePanel, inputTokens + outputTokens, 40);
    // Duplicate for seamless loop
    setSegments([...initial, ...initial]);
  }, [sessionId, activePanel, inputTokens, outputTokens]);

  // Refresh content periodically
  useEffect(() => {
    const id = setInterval(() => {
      setSegments((prev) => {
        const fresh = generateTickerSegments(sessionId, activePanel, inputTokens + outputTokens, 40);
        return [...fresh, ...fresh];
      });
    }, 10_000);
    return () => clearInterval(id);
  }, [sessionId, activePanel, inputTokens, outputTokens]);

  return (
    <div className="hud-bottom-ticker" aria-hidden="true">
      <div className="hud-ticker-track">
        {segments.map((seg, i) => (
          <span key={i}>
            <span style={seg.type === "signal" ? { color: "var(--color-accent)" } : undefined}>
              {seg.text}
            </span>
            {i < segments.length - 1 && <span className="hud-ticker-sep"> █ </span>}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create HudScanline**

Create `frontend/src/hud/HudScanline.tsx`:

```tsx
import { useReducedMotion } from "./hooks/useReducedMotion";
import "./styles/hud.css";

export function HudScanline() {
  const reduced = useReducedMotion();
  if (reduced) return null;

  return <div className="hud-scanline" aria-hidden="true" />;
}
```

- [ ] **Step 9: Verify types compile**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(hud): add HUD chrome components — viewport frame, top strip, bottom ticker, scanline"
```

---

### Task 4: ArcReactor SVG Component

**Files:**
- Create: `frontend/src/hud/ArcReactor.tsx`
- Modify: `frontend/src/components/Sidenav.tsx` (replace text brand with ArcReactor)
- Modify: `frontend/src/components/Sidenav.module.css` (adjust brand layout)

**Interfaces:**
- Consumes: `useHudState()` (reads `streaming` to speed up rotation)
- Produces: `<ArcReactor size?: number />` — animated SVG with three rotating rings

- [ ] **Step 1: Create ArcReactor component**

Create `frontend/src/hud/ArcReactor.tsx`:

```tsx
import { useHudState } from "./HudStateContext";
import { useReducedMotion } from "./hooks/useReducedMotion";

interface ArcReactorProps {
  size?: number;
}

export function ArcReactor({ size = 40 }: ArcReactorProps) {
  const { streaming } = useHudState();
  const reduced = useReducedMotion();
  const center = size / 2;
  const r1 = size * 0.42;
  const r2 = size * 0.32;
  const r3 = size * 0.22;
  const coreR = size * 0.08;

  const speedMultiplier = streaming ? 3 : 1;
  const outerDur = reduced ? 0 : 20 / speedMultiplier;
  const midDur = reduced ? 0 : 12 / speedMultiplier;
  const innerDur = reduced ? 0 : 8 / speedMultiplier;

  const ringStyle = (duration: number, reverse = false): React.CSSProperties =>
    reduced
      ? {}
      : {
          animation: `ring-spin ${duration}s linear infinite${reverse ? " reverse" : ""}`,
          transformOrigin: `${center}px ${center}px`,
        };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ filter: `drop-shadow(0 0 ${streaming ? 8 : 4}px var(--color-accent))` }}
    >
      {/* Core glow */}
      <circle cx={center} cy={center} r={coreR * 2} fill="url(#coreGradient)" />
      <defs>
        <radialGradient id="coreGradient">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outer ring */}
      <circle
        cx={center}
        cy={center}
        r={r1}
        stroke="var(--color-accent)"
        strokeWidth="1"
        strokeDasharray="4 8"
        opacity="0.5"
        style={ringStyle(outerDur)}
      />

      {/* Middle ring */}
      <circle
        cx={center}
        cy={center}
        r={r2}
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeDasharray="6 4"
        opacity="0.7"
        style={ringStyle(midDur, true)}
      />

      {/* Inner ring */}
      <circle
        cx={center}
        cy={center}
        r={r3}
        stroke="var(--color-accent)"
        strokeWidth="1"
        opacity="0.9"
        style={ringStyle(innerDur)}
      />

      {/* Core dot */}
      <circle cx={center} cy={center} r={coreR} fill="var(--color-accent)" opacity="0.9" />
    </svg>
  );
}
```

- [ ] **Step 2: Replace Sidenav brand with ArcReactor**

In `frontend/src/components/Sidenav.tsx`, add the import and replace the brand section:

Replace the brand `<div>` in the JSX:

```tsx
import { ArcReactor } from "../hud/ArcReactor";
```

Change the brand div from:
```tsx
<div className={styles.brand}>
  <span data-testid="health-dot" className={dotClass} />
  <span>Jarvis Bridge</span>
</div>
```
To:
```tsx
<div className={styles.brand}>
  <ArcReactor size={36} />
  <span>JARVIS</span>
</div>
```

Remove the `dotClass` logic and the `dot` CSS classes since the health dot is now in the HudTopStrip.

- [ ] **Step 3: Adjust Sidenav.module.css brand styling**

In `frontend/src/components/Sidenav.module.css`, update `.brand`:

```css
.brand {
  padding: 8px 16px 12px;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-accent);
}
```

Remove the `.dot`, `.dot.ok`, and `.dot.bad` rules.

- [ ] **Step 4: Verify types compile**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(hud): add ArcReactor SVG component, replace Sidenav brand"
```

---

### Task 5: HudShell Wrapper + Boot Sequence + Tab Dissolve + Glitch Effect

**Files:**
- Create: `frontend/src/hud/hooks/useBootSequence.ts`
- Create: `frontend/src/hud/HudShell.tsx`
- Modify: `frontend/src/App.tsx` (wrap with HudShell + HudStateProvider, wire HudDispatch)
- Modify: `frontend/src/main.tsx` (import hud.css)

**Interfaces:**
- Consumes: `useReducedMotion()`, `HudStateProvider`, all chrome components, GSAP
- Produces:
  - `<HudShell>` — wraps the app, injects chrome, runs boot sequence
  - `useBootSequence(containerRef, reducedMotion): { booted: boolean }` — GSAP timeline

- [ ] **Step 1: Create useBootSequence hook**

Create `frontend/src/hud/hooks/useBootSequence.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useReducedMotion } from "./useReducedMotion";

export function useBootSequence(containerRef: React.RefObject<HTMLDivElement | null>): boolean {
  const [booted, setBooted] = useState(false);
  const reduced = useReducedMotion();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !containerRef.current) return;
    ran.current = true;

    if (reduced) {
      setBooted(true);
      return;
    }

    const el = containerRef.current;
    const frame = el.querySelector(".hud-viewport-frame");
    const topStrip = el.querySelector(".hud-top-strip");
    const sidenav = el.querySelector("[data-hud-sidenav]");
    const main = el.querySelector("[data-hud-main]");
    const ticker = el.querySelector(".hud-bottom-ticker");
    const holo = el.querySelector("[data-hud-holo]");

    // Hide everything initially
    const targets = [frame, topStrip, sidenav, main, ticker, holo].filter(Boolean);
    gsap.set(targets, { opacity: 0 });
    if (main) gsap.set(main, { y: 8 });

    const tl = gsap.timeline({
      onComplete: () => setBooted(true),
    });

    // T+300ms: Corner brackets
    if (frame) tl.to(frame, { opacity: 1, duration: 0.2 }, 0.3);

    // T+400ms: Top strip
    if (topStrip) tl.to(topStrip, { opacity: 1, duration: 0.2 }, 0.4);

    // T+500ms: Sidenav
    if (sidenav) tl.to(sidenav, { opacity: 1, duration: 0.3 }, 0.5);

    // T+700ms: Main
    if (main) tl.to(main, { opacity: 1, y: 0, duration: 0.3 }, 0.7);

    // T+900ms: Holo
    if (holo) tl.to(holo, { opacity: 0.6, duration: 0.4 }, 0.9);

    // T+1100ms: Ticker
    if (ticker) tl.to(ticker, { opacity: 1, duration: 0.2 }, 1.1);

    return () => {
      tl.kill();
    };
  }, [containerRef, reduced]);

  return booted;
}
```

- [ ] **Step 2: Create HudShell component**

Create `frontend/src/hud/HudShell.tsx`:

```tsx
import { useRef, useEffect, type ReactNode } from "react";
import { HudViewportFrame } from "./HudViewportFrame";
import { HudTopStrip } from "./HudTopStrip";
import { HudBottomTicker } from "./HudBottomTicker";
import { HudScanline } from "./HudScanline";
import { useBootSequence } from "./hooks/useBootSequence";
import { useHudState } from "./HudStateContext";
import "./styles/hud.css";

interface HudShellProps {
  children: ReactNode;
}

export function HudShell({ children }: HudShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const booted = useBootSequence(containerRef);
  const { error } = useHudState();
  const mainRef = useRef<HTMLDivElement>(null);

  // Glitch effect on errors
  useEffect(() => {
    if (!error || !mainRef.current) return;
    const el = mainRef.current;
    el.style.animation = "glitch 0.3s ease-in-out";
    const timer = setTimeout(() => {
      el.style.animation = "";
    }, 300);
    return () => clearTimeout(timer);
  }, [error]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <HudViewportFrame />
      <HudTopStrip />
      <div
        ref={mainRef}
        data-hud-main
        style={{
          position: "relative",
          height: "calc(100vh - var(--hud-strip-h) - var(--hud-strip-h))",
          marginTop: "var(--hud-strip-h)",
          overflow: "hidden",
        }}
      >
        {children}
        <HudScanline />
      </div>
      <HudBottomTicker />
    </div>
  );
}
```

- [ ] **Step 3: Wire HudShell into App.tsx**

Modify `frontend/src/App.tsx`:

Add imports:
```tsx
import { HudStateProvider, useHudDispatch } from "./hud/HudStateContext";
import { HudShell } from "./hud/HudShell";
```

Wrap the return in `HudStateProvider` and `HudShell`. The `App` component becomes:

```tsx
export function App() {
  return (
    <HudStateProvider>
      <HudShell>
        <AppInner />
      </HudShell>
    </HudStateProvider>
  );
}

function AppInner() {
  const { route, navigate } = useHashRoute();
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const hudDispatch = useHudDispatch();

  useEffect(() => {
    hudDispatch.setActivePanel(route);
  }, [route, hudDispatch]);

  useEffect(() => {
    const onCwd = (e: Event) => {
      const detail = (e as CustomEvent<{ cwd: string | null }>).detail;
      setCwd(detail?.cwd ?? null);
    };
    window.addEventListener("jarvis:cwd-changed", onCwd);
    return () => window.removeEventListener("jarvis:cwd-changed", onCwd);
  }, []);

  const onHealthUpdate = useCallback((ok: boolean) => setHealthOk(ok), []);

  return (
    <ToastProvider>
      <HealthDot onUpdate={onHealthUpdate} />
      <div data-hud-sidenav style={{ display: "flex", height: "100%" }}>
        <Sidenav current={route} onNavigate={navigate} healthOk={healthOk} />
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          {route === "chat" && <ChatPanel />}
          {route === "status" && <StatusPanel active={true} />}
          {route === "settings" && <SettingsPanel />}
          {route === "skills-manage" && <SkillsManagePanel />}
          {route.startsWith("skill/") && <SkillPanel name={route.slice("skill/".length)} />}
          <TerminalDrawer cwd={cwd} />
        </main>
      </div>
    </ToastProvider>
  );
}
```

- [ ] **Step 4: Verify types compile and build succeeds**

```bash
cd frontend && npx tsc --noEmit && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(hud): add HudShell wrapper with boot sequence, glitch effect, and App integration"
```

---

### Task 6: Three.js Holographic Data Sphere

**Files:**
- Create: `frontend/src/hud/hooks/useHoloRenderer.ts`
- Create: `frontend/src/hud/HoloCanvas.tsx`
- Modify: `frontend/src/hud/HudShell.tsx` (add HoloCanvas)

**Interfaces:**
- Consumes: `useHudState()` (reads streaming, error, agentStatus), `useReducedMotion()`
- Produces: `<HoloCanvas />` — Three.js canvas with reactive data sphere + particles + bloom

- [ ] **Step 1: Create useHoloRenderer hook**

Create `frontend/src/hud/hooks/useHoloRenderer.ts`:

```ts
import { useEffect, useRef } from "react";
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  IcosahedronGeometry,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
  TorusGeometry,
  Mesh,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  AdditiveBlending,
  Clock,
  Color,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Vector2 } from "three";
import type { HudState } from "../HudStateContext";

interface HoloOptions {
  state: HudState;
  reducedMotion: boolean;
}

export function useHoloRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: HoloOptions,
) {
  const stateRef = useRef(options.state);
  stateRef.current = options.state;

  const rendererRef = useRef<{
    renderer: WebGLRenderer;
    composer: EffectComposer;
    animId: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Kill switch
    if (localStorage.getItem("hud:holo") === "off") return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);

    // Scene
    const scene = new Scene();
    const camera = new PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.z = 6;

    // Renderer
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    // Icosahedron wireframe
    const icoGeo = new IcosahedronGeometry(2, 1);
    const edgesGeo = new EdgesGeometry(icoGeo);
    const edgesMat = new LineBasicMaterial({
      color: new Color(0x5be9ff),
      transparent: true,
      opacity: 0.8,
      blending: AdditiveBlending,
    });
    const wireframe = new LineSegments(edgesGeo, edgesMat);
    scene.add(wireframe);

    // Orbit ring
    const torusGeo = new TorusGeometry(2.8, 0.02, 8, 64);
    const torusMat = new MeshBasicMaterial({
      color: new Color(0x5be9ff),
      transparent: true,
      opacity: 0.4,
      blending: AdditiveBlending,
    });
    const ring = new Mesh(torusGeo, torusMat);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);

    // Particles
    const particleCount = 30;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    const particleGeo = new BufferGeometry();
    particleGeo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const particleMat = new PointsMaterial({
      color: new Color(0x5be9ff),
      size: 0.03,
      transparent: true,
      opacity: 0.6,
      blending: AdditiveBlending,
    });
    const particles = new Points(particleGeo, particleMat);
    scene.add(particles);

    // Bloom
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new Vector2(width, height), 1.5, 0.4, 0.1);
    composer.addPass(bloomPass);

    // Clock
    const clock = new Clock();

    // Reduced motion: render one frame
    if (options.reducedMotion) {
      composer.render();
      rendererRef.current = { renderer, composer, animId: 0 };
      return;
    }

    // Animation loop
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const state = stateRef.current;

      const baseSpeed = 0.15;
      const speed = state.streaming ? baseSpeed * 3 : baseSpeed;

      // Wireframe rotation
      wireframe.rotation.y += speed * 0.016;
      wireframe.rotation.x = Math.sin(elapsed * 0.3) * 0.1;

      // Breathing scale
      const scale = 1 + Math.sin(elapsed * 0.5) * 0.02;
      wireframe.scale.setScalar(scale);

      // Ring rotation
      const ringSpeed = state.streaming ? 0.02 : 0.005;
      ring.rotation.z += ringSpeed;

      // Reactive colors
      if (state.error) {
        edgesMat.color.setHex(0xff3b3b);
        setTimeout(() => edgesMat.color.setHex(0x5be9ff), 200);
      }

      // Particle drift
      const posArr = particleGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        if (state.streaming) {
          // Pull toward center
          posArr[idx] *= 0.998;
          posArr[idx + 1] *= 0.998;
          posArr[idx + 2] *= 0.998;
          // Respawn if too close
          const dist = Math.sqrt(posArr[idx] ** 2 + posArr[idx + 1] ** 2 + posArr[idx + 2] ** 2);
          if (dist < 0.5) {
            posArr[idx] = (Math.random() - 0.5) * 8;
            posArr[idx + 1] = (Math.random() - 0.5) * 8;
            posArr[idx + 2] = (Math.random() - 0.5) * 8;
          }
        } else {
          // Gentle drift
          posArr[idx] += Math.sin(elapsed + i) * 0.002;
          posArr[idx + 1] += Math.cos(elapsed + i * 1.3) * 0.002;
        }
      }
      particleGeo.attributes.position.needsUpdate = true;

      composer.render();
      rendererRef.current!.animId = requestAnimationFrame(animate);
    };

    const animId = requestAnimationFrame(animate);
    rendererRef.current = { renderer, composer, animId };

    // Resize
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // Pause on hidden
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rendererRef.current?.animId ?? 0);
      } else {
        clock.start();
        rendererRef.current!.animId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(rendererRef.current?.animId ?? 0);
      renderer.dispose();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canvasRef, options.reducedMotion]);
}
```

- [ ] **Step 2: Create HoloCanvas component**

Create `frontend/src/hud/HoloCanvas.tsx`:

```tsx
import { useRef } from "react";
import { useHoloRenderer } from "./hooks/useHoloRenderer";
import { useHudState } from "./HudStateContext";
import { useReducedMotion } from "./hooks/useReducedMotion";

export function HoloCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useHudState();
  const reducedMotion = useReducedMotion();

  useHoloRenderer(canvasRef, { state, reducedMotion });

  if (localStorage.getItem("hud:holo") === "off") return null;

  return (
    <canvas
      ref={canvasRef}
      data-hud-holo
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
        pointerEvents: "none",
        mixBlendMode: "screen",
        opacity: 0.6,
      }}
    />
  );
}
```

- [ ] **Step 3: Add HoloCanvas to HudShell**

In `frontend/src/hud/HudShell.tsx`, add the import:

```tsx
import { HoloCanvas } from "./HoloCanvas";
```

Add `<HoloCanvas />` as the first child inside the container div (before `<HudViewportFrame />`):

```tsx
<div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
  <HoloCanvas />
  <HudViewportFrame />
  ...
```

- [ ] **Step 4: Verify types compile and build succeeds**

```bash
cd frontend && npx tsc --noEmit && npx vite build
```

Expected: No errors. Three.js imports resolve (already in package.json).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(hud): add Three.js holographic data sphere with bloom, particles, and reactive states"
```

---

### Task 7: WebAudio Sound Design

**Files:**
- Create: `frontend/src/hud/utils/sound-synth.ts`
- Create: `frontend/src/hud/hooks/useHudSound.ts`
- Modify: `frontend/src/hud/HudShell.tsx` (integrate sound events)

**Interfaces:**
- Consumes: localStorage `hud:sound`, `useHudState()` (streaming, error changes)
- Produces:
  - `createAudioContext(): AudioContext` — lazy singleton
  - `playBootChord(ctx)`, `playBlip(ctx)`, `playChirp(ctx)`, `playBuzz(ctx)`, `playChime(ctx)`, `playHum(ctx)` — synth functions
  - `useHudSound()` — hook that plays sounds in response to HUD events

- [ ] **Step 1: Create sound-synth utility**

Create `frontend/src/hud/utils/sound-synth.ts`:

```ts
let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function isMuted(): boolean {
  return localStorage.getItem("hud:sound") === "off";
}

export function playBootChord(): void {
  if (isMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Sine sweep 80Hz → 440Hz
  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(80, now);
  osc1.frequency.exponentialRampToValueAtTime(440, now + 1.2);

  // Triangle harmonic
  const osc2 = ctx.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(120, now);
  osc2.frequency.exponentialRampToValueAtTime(660, now + 1.2);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.3);
  gain.gain.linearRampToValueAtTime(0.08, now + 1.0);
  gain.gain.linearRampToValueAtTime(0, now + 1.5);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 1.5);
  osc2.stop(now + 1.5);
}

export function playBlip(): void {
  if (isMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.06);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.06);
}

export function playChirp(): void {
  if (isMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.linearRampToValueAtTime(660, now + 0.1);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.1);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

export function playBuzz(): void {
  if (isMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc1 = ctx.createOscillator();
  osc1.type = "square";
  osc1.frequency.setValueAtTime(200, now);

  const osc2 = ctx.createOscillator();
  osc2.type = "square";
  osc2.frequency.setValueAtTime(205, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.15);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.15);
  osc2.stop(now + 0.15);
}

export function playChime(): void {
  if (isMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(660, now);

  const gain1 = ctx.createGain();
  gain1.gain.setValueAtTime(0.1, now);
  gain1.gain.linearRampToValueAtTime(0, now + 0.08);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.08);

  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(880, now + 0.08);

  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0.1, now + 0.08);
  gain2.gain.linearRampToValueAtTime(0, now + 0.16);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.08);
  osc2.stop(now + 0.16);
}
```

- [ ] **Step 2: Create useHudSound hook**

Create `frontend/src/hud/hooks/useHudSound.ts`:

```ts
import { useEffect, useRef } from "react";
import { useHudState } from "../HudStateContext";
import { playBootChord, playBlip, playBuzz } from "../utils/sound-synth";

export function useHudSound(): void {
  const { streaming, error } = useHudState();
  const prevStreaming = useRef(streaming);
  const prevError = useRef(error);
  const bootPlayed = useRef(false);

  // Boot chord (once, on first user interaction)
  useEffect(() => {
    if (bootPlayed.current) return;
    const handler = () => {
      if (!bootPlayed.current) {
        bootPlayed.current = true;
        playBootChord();
      }
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("click", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);

  // Streaming start blip
  useEffect(() => {
    if (streaming && !prevStreaming.current) {
      playBlip();
    }
    prevStreaming.current = streaming;
  }, [streaming]);

  // Error buzz
  useEffect(() => {
    if (error && error !== prevError.current) {
      playBuzz();
    }
    prevError.current = error;
  }, [error]);
}
```

- [ ] **Step 3: Integrate useHudSound in HudShell**

In `frontend/src/hud/HudShell.tsx`, add:

```tsx
import { useHudSound } from "./hooks/useHudSound";
```

And call it at the top of the `HudShell` function body:

```tsx
export function HudShell({ children }: HudShellProps) {
  useHudSound();
  // ... rest of component
}
```

- [ ] **Step 4: Verify types compile**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(hud): add WebAudio sound design — boot chord, blip, buzz, chirp, chime"
```

---

### Task 8: Wire HudDispatch from ChatPanel (Bridge State to HUD)

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx` (dispatch streaming/error/session/usage to HudState)

**Interfaces:**
- Consumes: `useHudDispatch()`, existing `ChatPanelInner` state
- Produces: HudState updates flow whenever chat state changes

- [ ] **Step 1: Add HudDispatch bridge in ChatPanelInner**

In `frontend/src/components/ChatPanel.tsx`, add the import:

```tsx
import { useHudDispatch } from "../hud/HudStateContext";
```

Inside `ChatPanelInner`, add the dispatch bridge at the top of the function body (after existing hooks):

```tsx
const hudDispatch = useHudDispatch();

// Bridge chat state to HUD
useEffect(() => {
  hudDispatch.setStreaming(chat.busy);
}, [chat.busy, hudDispatch]);

useEffect(() => {
  hudDispatch.setSessionId(ctx.state.sessionId);
}, [ctx.state.sessionId, hudDispatch]);
```

Also, to bridge errors, add a listener for error patches in the transcript. Add after the existing `useEffect` hooks:

```tsx
useEffect(() => {
  const lastEntry = chat.transcript[chat.transcript.length - 1];
  if (lastEntry?.role === "assistant") {
    const errorPatch = lastEntry.patches.find((p) => p.type === "error");
    if (errorPatch && "message" in errorPatch) {
      hudDispatch.setError(String(errorPatch.message));
      // Clear after animation
      setTimeout(() => hudDispatch.setError(null), 500);
    }
  }
}, [chat.transcript, hudDispatch]);
```

- [ ] **Step 2: Verify types compile**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(hud): bridge chat state to HUD context for reactive effects"
```

---

### Task 9: Skill UI Mirror + Final Build Verification + Validation

**Files:**
- Create: `frontend/src/hud/styles/skill-ui.css`
- Modify: `frontend/src/hud/HudShell.tsx` (import skill-ui.css — exports for iframe use)

**Interfaces:**
- Consumes: JARVIS tokens
- Produces: `skill-ui.css` — mirrored token block for iframed skill UIs

- [ ] **Step 1: Create skill-ui.css**

Create `frontend/src/hud/styles/skill-ui.css`:

```css
/* Mirror JARVIS tokens for iframed skill UIs */
:root {
  --color-bg: #02060a;
  --color-surface-1: rgba(91, 233, 255, 0.04);
  --color-surface-2: rgba(91, 233, 255, 0.06);
  --color-text: #d8f5ff;
  --color-text-muted: rgba(216, 245, 255, 0.7);
  --color-border: rgba(91, 233, 255, 0.25);
  --color-border-strong: #5be9ff;
  --color-accent: #5be9ff;
  --color-success: #5be9ff;
  --color-warning: #ffb84a;
  --color-danger: #ff3b3b;

  --font-sans: 'Orbitron', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --radius-sm: 0;
  --radius-md: 2px;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 13px;
}

button {
  border-radius: var(--radius-sm);
}

input:focus, textarea:focus, select:focus, button:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent);
}
```

- [ ] **Step 2: Full build verification**

```bash
cd frontend && npx tsc --noEmit && npx vite build
```

Expected: No type errors, build succeeds, all assets generated in `public/`.

- [ ] **Step 3: Start dev server and verify visually**

```bash
cd frontend && npm run dev
```

Check:
1. JARVIS palette is applied (cyan on near-black)
2. Corner brackets visible at viewport edges
3. Top strip shows clock, agent dot, coords, brand
4. Bottom ticker scrolls hex data
5. Scanline drifts across main area
6. Arc reactor rotates in sidenav header
7. Holographic sphere visible behind content with bloom
8. Boot sequence plays on page load

- [ ] **Step 4: Validation checklist**

Walk each Phase 4 flow:
1. Chat send / stream / queue / stop
2. Switch sessions
3. Fork a session
4. Attach an image (paste/drop/picker)
5. Open the terminal drawer
6. Open a skill iframe
7. Toggle `prefers-reduced-motion` in OS settings — all animations should stop
8. Sound mute toggle in top strip works
9. Set `localStorage.setItem("hud:holo", "off")` → reload → no Three.js canvas
10. Run Lighthouse perf/a11y audit

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(hud): add skill-ui.css mirror, final build verification"
```
