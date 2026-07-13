# Frontend Redesign: Quiet Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the entire `frontend/` app (Sidenav, ChatPanel and its children, TerminalDrawer, Status/Settings/Skills panels) with the "Quiet Signal" token system from `docs/superpowers/specs/2026-07-13-frontend-quiet-signal-design.md`, and relocate the Steer/Queue/Stop composer controls to be contextual (inline, replacing Send, only while the agent is responding) instead of a persistent header toggle.

**Architecture:** Pure re-skin driven by a rewritten `tokens.css` — every component already consumes CSS custom properties, so most tasks are CSS-only. The one real behavior change is in `Composer.tsx`/`ChatPanel.tsx`: Steer becomes gated by `busy` (matching Queue/Stop) instead of always visible, which requires fixing a latent bug where `steerEnabled` can stay `true` after a turn ends. `TerminalDrawer.tsx`, `PastChatsMenu.tsx`, `StatusPanel.tsx`, `SettingsPanel.tsx`, and `SkillsManagePanel.tsx` currently use inline `style={}` props instead of CSS modules — each gets a CSS module extracted as part of its re-skin task, matching the pattern every other component already uses.

**Tech Stack:** React 18 + TypeScript (strict), Vite, CSS Modules, Vitest + Testing Library, `@xterm/xterm`.

## Global Constraints

- TypeScript `strict: true`; frontend is ESM (Vite), no ESLint/Prettier — `tsc --noEmit` is the enforced gate.
- Run from `frontend/`: `npx tsc --noEmit` (or `npm run typecheck`) and `npx vitest run` (or `npm test -- --run`). Run from repo root: `npm run test:web` (does the same) and root `npm run typecheck` (backend only — does not cover `frontend/`, must run frontend's own typecheck separately).
- No new backend/data plumbing — every task is client-side only.
- No signature/waveform ("Signal Line") element — explicitly deferred in the spec. Do not add one.
- Use the exact hex values and font names from the spec's Color and Typography tables — do not invent new ones.
- Match existing repo conventions: CSS Modules (`*.module.css` + `styles` import), not inline `style={}`, for anything beyond a one-off.

---

## Color & Typography Reference (from spec — copy these values exactly)

| Token | Hex |
|---|---|
| `--color-bg` | `#13161a` |
| `--color-surface-1` | `#1b1f25` |
| `--color-surface-2` | `#242a31` |
| `--color-surface-3` | `#2b323a` |
| `--color-border` | `#2d343c` |
| `--color-border-strong` | `#3d454f` |
| `--color-text` | `#e7e9ec` |
| `--color-text-muted` | `#8b9198` |
| `--color-text-dim` | `#5e646b` |
| `--color-signal` | `#ffb454` |
| `--color-accent` | `#6fb7c9` |
| `--color-accent-strong` | `#8fcbda` |
| `--color-success` | `#6bbf8a` |
| `--color-danger` | `#e0685a` |

Fonts (Google Fonts): Display = `Space Grotesk` (500/600/700), Body = `IBM Plex Sans` (400/500/600), Mono = `IBM Plex Mono` (400/500/600).

---

### Task 1: Token system rewrite

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/styles/global.css`

**Interfaces:**
- Produces: every CSS custom property consumed by later tasks (`--color-*`, `--font-*`, `--radius-*`). No component prop/type changes.

- [ ] **Step 1: Add Google Fonts links to `frontend/index.html`**

Add inside `<head>`, after the `viewport` meta tag:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Rewrite `frontend/src/styles/tokens.css`**

```css
:root {
  --color-bg: #13161a;
  --color-surface-1: #1b1f25;
  --color-surface-2: #242a31;
  --color-surface-3: #2b323a;
  --color-text: #e7e9ec;
  --color-text-muted: #8b9198;
  --color-text-dim: #5e646b;
  --color-border: #2d343c;
  --color-border-strong: #3d454f;
  --color-signal: #ffb454;
  --color-signal-tint: rgba(255, 180, 84, 0.15);
  --color-accent: #6fb7c9;
  --color-accent-strong: #8fcbda;
  --color-accent-tint: rgba(111, 183, 201, 0.15);
  --color-success: #6bbf8a;
  --color-warning: #d9a441;
  --color-danger: #e0685a;
  --font-display: "Space Grotesk", sans-serif;
  --font-sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius-sm: 3px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.3);
  --sidenav-w: 208px;
  --chat-composer-h: 96px;
  --header-h: 48px;
}
```

- [ ] **Step 3: Update `frontend/src/styles/global.css` base element styles**

Replace the `button`, `button.primary`, `input/textarea/select` rules with:

```css
button { font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  padding: 4px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--color-border-strong); background: var(--color-surface-2); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }
button.primary { background: var(--color-accent); border-color: var(--color-accent-strong); color: var(--color-bg); font-weight: 600; }
button.primary:hover:not(:disabled) { background: var(--color-accent-strong); }
button.danger { border-color: var(--color-danger); color: var(--color-danger); }
button.danger:hover:not(:disabled) { background: rgba(224, 104, 90, 0.12); }

input, textarea, select { font: inherit; color: inherit; background: var(--color-surface-1);
  border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 6px 8px; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--color-accent); }
```

Leave the rest of `global.css` (`*`/`html,body,#root`/`body`/`textarea{resize}`/`code,pre`/scrollbar rules) unchanged — `body`'s existing `font-family: var(--font-sans)` now resolves to IBM Plex Sans automatically since the token value changed.

- [ ] **Step 4: Verify**

Run:
```bash
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: PASS, no test changes needed yet (no component markup changed).

Run `npm run dev:web` from repo root, open the app in a browser. Expected: background is dark graphite (not blue-black), buttons/inputs unchanged in shape, body text renders in IBM Plex Sans (visibly different letterforms from the old system-sans stack — check via browser devtools computed `font-family` on `<body>`).

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/src/styles/tokens.css frontend/src/styles/global.css
git commit -m "feat(frontend): rewrite design tokens — Quiet Signal palette + type system"
```

---

### Task 2: Sidenav re-skin

**Files:**
- Modify: `frontend/src/components/Sidenav.module.css`

**Interfaces:**
- Consumes: tokens from Task 1.
- No changes to `Sidenav.tsx` — it already renders `styles.dot`/`styles.ok`/`styles.bad`/`styles.tab`/`styles.active` classes; this task only changes what those classes look like.

- [ ] **Step 1: Rewrite `frontend/src/components/Sidenav.module.css`**

```css
.sidenav {
  width: var(--sidenav-w);
  flex-shrink: 0;
  background: var(--color-surface-1);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}
.brand {
  padding: 2px 6px 18px;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-dim);
  flex-shrink: 0;
}
.dot.ok {
  background: var(--color-signal);
  box-shadow: 0 0 0 3px var(--color-signal-tint);
  animation: dotPulse 2.4s ease-in-out infinite;
}
.dot.bad { background: var(--color-danger); }
@media (prefers-reduced-motion: reduce) {
  .dot.ok { animation: none; }
}
@keyframes dotPulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 3px var(--color-signal-tint); }
  50% { opacity: 0.55; box-shadow: 0 0 0 5px transparent; }
}
.groupLabel {
  padding: 14px 6px 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--color-text-dim);
}
.tab {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 7px 8px;
  font-size: 13.5px;
  color: var(--color-text-muted);
}
.tab:hover { background: var(--color-surface-2); color: var(--color-text); border-color: transparent; }
.tab.active {
  background: var(--color-surface-2);
  color: var(--color-text);
  border-left: 2px solid var(--color-signal);
  padding-left: 6px;
  font-weight: 600;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run:
```bash
cd frontend && npx vitest run src/components/Sidenav.test.tsx
```
Expected: PASS — `Sidenav.test.tsx` only asserts text content, `active` class substring match, and `ok`/`bad` class substring match on `[data-testid="health-dot"]`; none of those class names changed, only their CSS rules.

- [ ] **Step 3: Manual visual check**

Run `npm run dev:web`, open the app. Expected: sidenav brand uses the Space Grotesk display face, the health dot pulses amber when connected (steady red when the backend is down), and the active nav tab shows a left amber accent border instead of a filled highlight.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Sidenav.module.css
git commit -m "feat(frontend): re-skin Sidenav with Quiet Signal tokens"
```

---

### Task 3: Remove the header Steer button

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/components/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ChatPanelInner`'s header no longer renders a "Steer" button. `steerEnabled` state and `setSteerEnabled` remain in `ChatPanelInner` (still passed to `<Composer>` as `steerEnabled`/`onToggleSteer` — Task 4 relocates the actual toggle button into `Composer`, this task only removes the duplicate header one).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/ChatPanel.test.tsx`, inside the existing `describe("<ChatPanel>", ...)` block:

```tsx
  it("does not render a Steer button in the header", () => {
    render(
      <ToastProvider>
        <ChatPanel />
      </ToastProvider>,
    );
    expect(screen.queryByText("Steer")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd frontend && npx vitest run src/components/ChatPanel.test.tsx
```
Expected: FAIL — the header's Steer button is still present (this test also implicitly holds until Task 4, since `Composer`'s own Steer button is gated by `busy` and won't render for an idle chat either; if it fails for the wrong reason at this stage, that's fine — Steps 3 removes the header one specifically).

- [ ] **Step 3: Remove the header Steer button from `ChatPanel.tsx`**

In `frontend/src/components/ChatPanel.tsx`, in the header `<div className={styles.header}>` block, delete this button element entirely:

```tsx
            <button
              onClick={() => setSteerEnabled((v) => !v)}
              disabled={!ctx.state.capabilities?.steer}
              className={steerEnabled ? "primary" : ""}
            >
              Steer
            </button>
```

Leave every other header button (Info, Chats, +New, Fork, AA) and the `steerEnabled`/`setSteerEnabled` state declaration untouched — they're still needed for Task 4/5.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd frontend && npx vitest run src/components/ChatPanel.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/components/ChatPanel.test.tsx
git commit -m "fix(frontend): remove duplicate header Steer button"
```

---

### Task 4: Composer — inline Queue/Stop/Steer swap while responding

**Files:**
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/Composer.module.css`
- Modify: `frontend/src/components/Composer.test.tsx`

**Interfaces:**
- Consumes: `ComposerProps` unchanged (`busy`, `steerEnabled`, `steerSupported`, `onSteer`, `onCancel`, `onQueue`, `onToggleSteer`, etc. — no prop signature changes).
- Produces: when `busy` is `false`, only the Send button (plus the attach button) renders in `.actions`. When `busy` is `true`, Send is replaced by three buttons — Queue, Stop, Steer (Steer only if `steerSupported`) — in the same row, in that order.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/Composer.test.tsx`, inside `describe("<Composer>", ...)`:

```tsx
  it("shows only Send when idle, not Queue or Steer", () => {
    render(<Composer {...baseProps} busy={false} />);
    expect(screen.getByText("Send")).toBeInTheDocument();
    expect(screen.queryByText("Queue")).not.toBeInTheDocument();
    expect(screen.queryByText("Steer")).not.toBeInTheDocument();
  });

  it("shows Queue, Stop, and Steer inline instead of Send while busy", () => {
    render(<Composer {...baseProps} busy={true} />);
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
    expect(screen.getByText("Queue")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.getByText("Steer")).toBeInTheDocument();
  });

  it("does not show Steer while busy if the agent doesn't support it", () => {
    render(<Composer {...baseProps} busy={true} steerSupported={false} />);
    expect(screen.getByText("Queue")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.queryByText("Steer")).not.toBeInTheDocument();
  });

  it("calls onQueue with the current text when Queue is clicked", () => {
    const onQueue = vi.fn();
    render(<Composer {...baseProps} busy={true} onQueue={onQueue} />);
    const textarea = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(textarea, { target: { value: "later" } });
    fireEvent.click(screen.getByText("Queue"));
    expect(onQueue).toHaveBeenCalledWith("later");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd frontend && npx vitest run src/components/Composer.test.tsx
```
Expected: FAIL — Steer currently renders whenever `steerSupported` regardless of `busy`, and the three buttons render in a vertical stack alongside Send rather than replacing it.

- [ ] **Step 3: Rewrite the `.actions` block in `frontend/src/components/Composer.tsx`**

Replace the existing `<div className={styles.actions}>...</div>` block with:

```tsx
        <div className={styles.actions}>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!imagesSupported} title="Attach image">📎</button>
          {busy ? (
            <div className={styles.respondingActions}>
              <button type="button" onClick={() => void onQueue(text)} disabled={!text.trim()}>Queue</button>
              <button type="button" className="danger" onClick={() => void onCancel()}>Stop</button>
              {steerSupported && (
                <button type="button" className={steerEnabled ? "primary" : ""} onClick={onToggleSteer}>Steer</button>
              )}
            </div>
          ) : (
            <button type="submit" className="primary">Send</button>
          )}
        </div>
```

- [ ] **Step 4: Update `frontend/src/components/Composer.module.css`**

Replace the `.actions` rule and add a new `.respondingActions` rule:

```css
.actions { display: flex; align-items: center; gap: 6px; }
.respondingActions { display: flex; gap: 6px; }
.actions button { padding: 6px 12px; }
```

(Remove the old `.actions button { min-width: 80px; }` — the vertical-stack sizing no longer applies.)

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd frontend && npx vitest run src/components/Composer.test.tsx
```
Expected: PASS — including the two pre-existing tests `"shows the cancel button while busy"` and `"calls onCancel when stop is clicked"`, which still hold since Stop still renders while busy.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Composer.tsx frontend/src/components/Composer.module.css frontend/src/components/Composer.test.tsx
git commit -m "feat(frontend): swap Send for inline Queue/Stop/Steer while agent responds"
```

---

### Task 5: Fix stale `steerEnabled` after a turn ends

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/components/ChatPanel.test.tsx`

**Context:** `ChatPanelInner` holds `steerEnabled` as local state. `Composer`'s `submit()` routes based on it: `if (steerEnabled) onSteer(...)`, independent of `busy`. Before Task 4, the Steer toggle was visible (and thus reachable) at all times, so a user could flip it on, the turn could end, and it would just stay armed with the button still visible to turn back off. After Task 4, the Steer button is hidden whenever `!busy` — so if `steerEnabled` is `true` when a turn ends, there is no longer any visible control to turn it back off, and the *next* normal send would silently go through `onSteer` instead of `onSend`. Reset it automatically when a turn ends.

**Interfaces:**
- Consumes: `chat.busy: boolean` (from `useChat()`, already destructured as `chat` in `ChatPanelInner`).
- Produces: `steerEnabled` is forced back to `false` the moment `chat.busy` transitions from `true` to `false`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/ChatPanel.test.tsx`. This needs the SSE-mocking pattern already used in `frontend/src/state/useChat.test.tsx` — import `client` and mock `fetchJSON`/`fetchSSE` directly rather than hitting the network:

```tsx
import { vi } from "vitest";
import * as client from "../api/client";
import type { ChatInitResponse } from "../api/types";
```

(Add these imports at the top of the file, alongside the existing ones.)

```tsx
  it("resets steer mode once the turn that armed it finishes", async () => {
    const initResponse: ChatInitResponse = {
      ok: true,
      backend: { kind: "fake", role: "chat", model: null },
      sessionId: "sess-1",
      cwd: "/tmp/ws",
      resumed: false,
      capabilities: {
        multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: true,
        toolApprovals: true, slashCommands: false, canFork: true, images: false,
      },
      slashCommands: [], history: [],
      autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
      model: { supported: false, available: [], current: null },
    };
    vi.spyOn(client, "fetchJSON").mockResolvedValue({ ok: true, status: 200, data: initResponse });
    let resolveDone: (() => void) | undefined;
    vi.spyOn(client, "fetchSSE").mockImplementation((_url, _body, handlers) => ({
      abort: vi.fn(),
      done: new Promise<void>((resolve) => {
        resolveDone = () => { handlers.onDone?.(); resolve(); };
      }),
    }));

    render(
      <ToastProvider>
        <ChatPanel />
      </ToastProvider>,
    );

    // Wait for init to resolve and the composer to be interactive.
    const textarea = await screen.findByPlaceholderText(/type a message/i);
    fireEvent.change(textarea, { target: { value: "go" } });
    fireEvent.click(screen.getByText("Send"));

    // Now busy — Steer should be visible; arm it.
    const steerBtn = await screen.findByText("Steer");
    fireEvent.click(steerBtn);

    // End the turn.
    resolveDone?.();
    await screen.findByText("Send"); // busy is false again, Send is back

    // Steer button is gone (contextual to busy) — send a normal message.
    expect(screen.queryByText("Steer")).not.toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "normal message" } });
    fireEvent.click(screen.getByText("Send"));

    // If steerEnabled had stayed true, this would have hit /chat/steer, not /chat/send.
    const sendCalls = (client.fetchSSE as ReturnType<typeof vi.fn>).mock.calls;
    expect(sendCalls[sendCalls.length - 1][0]).toBe("/chat/send");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd frontend && npx vitest run src/components/ChatPanel.test.tsx
```
Expected: FAIL — `steerEnabled` stays `true` after the turn ends, so the second send goes through `sendSteer` (`fetchJSON("/chat/steer", ...)`) rather than `sendMessage` (`fetchSSE("/chat/send", ...)`), and the last `fetchSSE` call recorded is still the first one — the assertion on `sendCalls[sendCalls.length - 1][0]` fails to be `"/chat/send"` a second time, or the test times out waiting for expected UI state.

- [ ] **Step 3: Add the reset effect in `ChatPanelInner`**

In `frontend/src/components/ChatPanel.tsx`, inside `ChatPanelInner`, immediately after the existing `useEffect` that sets `document.title` on `ctx.state.title` change, add:

```tsx
  useEffect(() => {
    if (!chat.busy) setSteerEnabled(false);
  }, [chat.busy]);
```

This runs on every render where `chat.busy` is `false`, including mount — that's fine, `setSteerEnabled(false)` when it's already `false` is a no-op re-render-wise (React bails out on identical state).

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd frontend && npx vitest run src/components/ChatPanel.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Run the full frontend suite to check for regressions**

Run:
```bash
cd frontend && npx vitest run
```
Expected: PASS — this touches shared state timing in `ChatPanelInner`, worth confirming nothing else broke.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/components/ChatPanel.test.tsx
git commit -m "fix(frontend): reset steer mode when a turn ends, not just visually"
```

---

### Task 6: Message re-skin — log-style transcript entries

**Files:**
- Modify: `frontend/src/components/Message.tsx`
- Modify: `frontend/src/components/Message.module.css`

**Context:** Per the spec, user messages drop the rounded chat-bubble look in favor of a left accent border + `>` prefix (mono), consistent with the "signal/log" visual language. Assistant messages keep using `<Timeline>` internally (untouched) but lose the bubble chrome too. `Message.test.tsx` only asserts on text content and the presence of `error` in the root element's `className`, plus an `<img>` for attachments — none of that depends on the "You"/"Assistant" role labels or the bubble div, so this is safe to restructure.

**Interfaces:**
- Consumes: `MessageEntry` type unchanged.
- Produces: no prop/type changes — internal markup and CSS only.

- [ ] **Step 1: Rewrite `frontend/src/components/Message.tsx`**

```tsx
import { Timeline } from "./Timeline";
import type { ImageAttachment, ChatPatch } from "../api/types";
import styles from "./Message.module.css";

export type MessageEntry =
  | { role: "user"; text: string; images?: ImageAttachment[] }
  | { role: "assistant"; patches: ChatPatch[] };

export function Message({
  entry,
  onApproval,
  onSteerAck,
  onImagesSkipped,
}: {
  entry: MessageEntry;
  onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
  onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
}) {
  if (entry.role === "user") {
    return (
      <div className={`${styles.message} ${styles.user}`}>
        {entry.text && (
          <div className={styles.userLine}>
            <span className={styles.prefix}>&gt;</span>
            {entry.text}
          </div>
        )}
        {entry.images && entry.images.length > 0 && (
          <div className={styles.attachments}>
            {entry.images.map((img, idx) => (
              <img key={idx} src={`data:${img.mimeType};base64,${img.data}`} alt={img.filename || "image"} title={img.filename} />
            ))}
          </div>
        )}
      </div>
    );
  }
  const hasError = entry.patches.some((p) => p.type === "error");
  return (
    <div className={`${styles.message} ${styles.assistant} ${hasError ? styles.error : ""}`}>
      <Timeline patches={entry.patches} onApproval={onApproval} onSteerAck={onSteerAck} onImagesSkipped={onImagesSkipped} />
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `frontend/src/components/Message.module.css`**

```css
.message { display: flex; flex-direction: column; gap: 6px; }
.userLine {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text);
  padding-left: 12px;
  border-left: 2px solid var(--color-accent);
  word-wrap: break-word;
}
.prefix { color: var(--color-accent); margin-right: 8px; }
.assistant { padding-left: 12px; border-left: 2px solid transparent; max-width: 68ch; }
.error { border-left-color: var(--color-danger); color: var(--color-danger); }
.attachments { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; padding-left: 12px; }
.attachments img {
  max-width: 120px;
  max-height: 120px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}
```

- [ ] **Step 3: Run tests to verify no regressions**

Run:
```bash
cd frontend && npx vitest run src/components/Message.test.tsx src/components/Transcript.test.tsx src/components/ChatPanel.test.tsx
```
Expected: PASS. The error-class test checks `container.firstElementChild?.className` matches `/error/` — the root `.message.assistant.error` div still carries the literal string `error` via `styles.error`, since CSS Modules class names are hashed but the test only checks for the substring `error`, which CSS-module hashing preserves (e.g. `Message-module__error__xyz123`).

- [ ] **Step 4: Manual visual check**

Run `npm run dev:web`, send a message. Expected: your message shows as a mono `>` -prefixed line with a teal left border, no rounded bubble; the assistant's reply has a thin left border (transparent normally, red if an error patch appears) instead of a bubble.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Message.tsx frontend/src/components/Message.module.css
git commit -m "feat(frontend): re-skin transcript messages as log-style entries"
```

---

### Task 7: Timeline, Transcript, and ChatPanel shell re-skin

**Files:**
- Modify: `frontend/src/components/Timeline.module.css`
- Modify: `frontend/src/components/Transcript.module.css`
- Modify: `frontend/src/components/ChatPanel.module.css`

**Interfaces:**
- CSS-only; no `.tsx` changes, no prop/type changes.

- [ ] **Step 1: Rewrite `frontend/src/components/Timeline.module.css`**

```css
.timeline { display: flex; flex-direction: column; gap: 8px; font-family: var(--font-sans); }
.text { word-wrap: break-word; }
.thought {
  font-style: italic;
  font-size: 12.5px;
  color: var(--color-text-dim);
  border-left: 2px solid var(--color-border);
  padding-left: 10px;
}
.thought summary { cursor: pointer; user-select: none; font-weight: 600; }
.tool {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 7px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--color-text-muted);
}
.tool summary { cursor: pointer; user-select: none; }
.tool summary::before { content: "▣ "; color: var(--color-signal); }
.toolArgs {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
}
.toolResult {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border);
}
.toolError { border-color: var(--color-danger); }
.toolError summary { color: var(--color-danger); }
.ok { color: var(--color-success); font-weight: 600; }
.err { color: var(--color-danger); font-weight: 600; }
.usage {
  display: flex;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-dim);
}
.usage span {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 1px 8px;
}
.errorMsg {
  color: var(--color-danger);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}
```

- [ ] **Step 2: Rewrite `frontend/src/components/Transcript.module.css`**

```css
.transcript {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.empty {
  margin: auto;
  text-align: center;
  color: var(--color-text-dim);
  font-family: var(--font-display);
}
.empty h2 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
.empty p { margin: 0; font-family: var(--font-sans); font-size: 13px; }
```

- [ ] **Step 3: Rewrite `frontend/src/components/ChatPanel.module.css`**

```css
.panel { display: flex; flex: 1; flex-direction: column; overflow: hidden; }
.stage { display: grid; grid-template-columns: 1fr 280px; flex: 1; overflow: hidden; }
.main { display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--color-border); }
.infoHidden { display: none; }
.header {
  display: flex; align-items: center; gap: 8px; padding: 10px 18px;
  height: var(--header-h); border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-1); flex-shrink: 0;
}
.header h1 {
  margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 600; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.header button { padding: 5px 10px; font-size: 12.5px; }
```

- [ ] **Step 4: Verify**

Run:
```bash
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: PASS, full suite green — CSS-only changes.

- [ ] **Step 5: Manual visual check**

Run `npm run dev:web`. Expected: tool-call cards use mono type with an amber `▣` glyph, token usage pills sit in muted mono text, and the empty-transcript state ("Start a conversation") uses the Space Grotesk display face for its heading.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Timeline.module.css frontend/src/components/Transcript.module.css frontend/src/components/ChatPanel.module.css
git commit -m "feat(frontend): re-skin transcript timeline and chat header with Quiet Signal tokens"
```

---

### Task 8: InfoPanel and ApprovalModal re-skin

**Files:**
- Modify: `frontend/src/components/InfoPanel.module.css`
- Modify: `frontend/src/components/ApprovalModal.module.css`

**Interfaces:**
- CSS-only; no `.tsx` or prop/type changes.

- [ ] **Step 1: Rewrite `frontend/src/components/InfoPanel.module.css`**

```css
.panel {
  background: var(--color-surface-1);
  overflow-y: auto;
  padding: 14px;
}
.card {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px;
  margin-bottom: 10px;
}
.card h3 {
  margin: 0 0 8px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-dim);
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  margin: 6px 0;
}
.key { color: var(--color-text-muted); }
.val {
  font-family: var(--font-mono);
  word-break: break-all;
  text-align: right;
  color: var(--color-text);
}
```

- [ ] **Step 2: Rewrite `frontend/src/components/ApprovalModal.module.css`**

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(19, 22, 26, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  min-width: 360px;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
}
.header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}
.header h2 { margin: 0; font-family: var(--font-display); font-size: 14px; font-weight: 600; }
.body { padding: 16px; font-size: 13px; }
.options {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.options button { text-align: left; }
```

- [ ] **Step 3: Verify**

Run:
```bash
cd frontend && npx vitest run src/components/InfoPanel.test.tsx src/components/ApprovalModal.test.tsx
```
Expected: PASS — CSS-only.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/InfoPanel.module.css frontend/src/components/ApprovalModal.module.css
git commit -m "feat(frontend): re-skin InfoPanel and ApprovalModal with Quiet Signal tokens"
```

---

### Task 9: PastChatsMenu — extract inline styles to a CSS module

**Files:**
- Modify: `frontend/src/components/PastChatsMenu.tsx`
- Create: `frontend/src/components/PastChatsMenu.module.css`

**Interfaces:**
- Consumes: `PastChatsMenuProps` unchanged.
- Produces: no behavior change — same conditional render (`if (!open) return null`), same `onClose`/`onSwitch` callbacks. Markup restructured to use CSS Modules instead of inline `style={}`.

- [ ] **Step 1: Create `frontend/src/components/PastChatsMenu.module.css`**

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(19, 22, 26, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
}
.modal {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  min-width: 360px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 16px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.header h2 { margin: 0; font-family: var(--font-display); font-size: 14px; font-weight: 600; }
.empty { color: var(--color-text-dim); font-size: 13px; }
.list { list-style: none; padding: 0; margin: 0; }
.item {
  padding: 6px 4px;
  cursor: pointer;
  color: var(--color-accent);
  font-size: 13px;
  border-radius: var(--radius-sm);
}
.item:hover { background: var(--color-surface-2); }
```

- [ ] **Step 2: Rewrite `frontend/src/components/PastChatsMenu.tsx`**

```tsx
import type { SessionSummary } from "../api/types";
import styles from "./PastChatsMenu.module.css";

export interface PastChatsMenuProps {
  open: boolean;
  sessions: SessionSummary[];
  onClose: () => void;
  onSwitch: (sessionId: string) => void;
}

export function PastChatsMenu({ open, sessions, onClose, onSwitch }: PastChatsMenuProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.modal}>
        <header className={styles.header}>
          <h2>Chats</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {sessions.length === 0 ? (
          <div className={styles.empty}>No past chats yet.</div>
        ) : (
          <ul className={styles.list}>
            {sessions.map((s) => (
              <li key={s.sessionId} className={styles.item} onClick={() => onSwitch(s.sessionId)}>
                {s.customTitle || s.title || s.sessionId.slice(0, 12)}
                {s.pinned ? " 📌" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

(Copy text changed from `"(no past chats yet)"` to `"No past chats yet."` — see Task 12 for the reasoning; called out here too since it's touched in this task's diff.)

- [ ] **Step 3: Verify**

Run:
```bash
cd frontend && npx vitest run src/components/PastChatsMenu.test.tsx
```
Read `frontend/src/components/PastChatsMenu.test.tsx` first if this fails on the empty-state copy — update its assertion string to match `"No past chats yet."` if it asserts the old exact text.

Expected: PASS after any needed test-string update.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PastChatsMenu.tsx frontend/src/components/PastChatsMenu.module.css frontend/src/components/PastChatsMenu.test.tsx
git commit -m "refactor(frontend): move PastChatsMenu off inline styles onto CSS module"
```

---

### Task 10: TerminalDrawer — retheme + extract inline styles

**Files:**
- Modify: `frontend/src/components/TerminalDrawer.tsx`
- Create: `frontend/src/components/TerminalDrawer.module.css`

**Context:** `@xterm/xterm`'s `Terminal` constructor takes a plain JS `theme` object — it cannot consume CSS custom properties (`var(--color-bg)` would be passed through as a literal invalid color string). Use the token hex values as JS literals in that one spot only; everything else in the component moves to a CSS module like every other component.

**Interfaces:**
- Consumes: `{ cwd, open, onClose }` props, unchanged.
- Produces: no behavior change to the WebSocket/xterm wiring — same `write`/`onData`/`onResize`/`fit`/`dispose` calls, same reconnect-on-`cwd`-change effect.

- [ ] **Step 1: Create `frontend/src/components/TerminalDrawer.module.css`**

```css
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 80vw;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-bg);
  border-left: 1px solid var(--color-border);
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.4);
  transition: transform 200ms ease;
  z-index: 20;
}
.drawer.closed { transform: translateX(100%); }
.drawer.open { transform: translateX(0); }
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}
.closeBtn {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 2px 4px;
}
.body {
  flex: 1;
  min-height: 0;
  background: var(--color-bg);
  padding: 4px;
}
```

- [ ] **Step 2: Rewrite `frontend/src/components/TerminalDrawer.tsx`**

Replace the `import` block and the final `return (...)` JSX. Keep the entire body of the `useEffect` (WebSocket/xterm wiring) exactly as-is except for the `theme` line called out below — do not change any connection/data logic.

Change the import line:
```tsx
import { useEffect, useRef, useState } from "react";
import styles from "./TerminalDrawer.module.css";
```

Change the `Terminal` construction line from:
```tsx
      const term = new Terminal({ convertEol: true, fontFamily: "var(--font-mono, monospace)", fontSize: 12, theme: { background: "#001020" } });
```
to:
```tsx
      // xterm's theme takes literal color values, not CSS custom properties.
      const term = new Terminal({
        convertEol: true,
        fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        theme: { background: "#13161a", foreground: "#e7e9ec", cursor: "#ffb454" },
      });
```

Replace the final `return (...)` block with:

```tsx
  return (
    <div className={`${styles.drawer} ${open ? styles.open : styles.closed}`}>
      <header className={styles.header}>
        <span>shell · cwd={cwd ?? "(unset)"} · {status}</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close (Ctrl+`)">×</button>
      </header>
      <div ref={containerRef} className={styles.body} />
    </div>
  );
```

- [ ] **Step 3: Verify**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: PASS.

There is no `TerminalDrawer.test.tsx` in the current suite, so run the full suite to confirm nothing else references this component's old inline-style structure:
```bash
cd frontend && npx vitest run
```
Expected: PASS.

- [ ] **Step 4: Manual visual check**

Run `npm run dev:web`, press `Ctrl+\`` (or click the terminal toggle if present in the UI at this point) to open the drawer, run a command. Expected: terminal background matches the app's dark graphite (not the old navy `#001020`), text is legible in the new mono face, and the cursor renders in signal amber.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TerminalDrawer.tsx frontend/src/components/TerminalDrawer.module.css
git commit -m "feat(frontend): retheme TerminalDrawer and move off inline styles"
```

---

### Task 11: Status / Settings / Skills panels — extract inline styles, apply tokens

**Files:**
- Modify: `frontend/src/components/StatusPanel.tsx`
- Create: `frontend/src/components/StatusPanel.module.css`
- Modify: `frontend/src/components/SettingsPanel.tsx`
- Create: `frontend/src/components/SettingsPanel.module.css`
- Modify: `frontend/src/components/SkillsManagePanel.tsx`
- Create: `frontend/src/components/SkillsManagePanel.module.css`

**Interfaces:**
- All three: props unchanged, polling/localStorage/fetch logic unchanged. Only inline `style={}` usages are replaced with CSS module classes, and headings pick up the display font.

- [ ] **Step 1: Create `frontend/src/components/StatusPanel.module.css`**

```css
.panel { padding: 18px 20px; }
.panel h2 { font-family: var(--font-display); font-size: 16px; margin: 0 0 12px; }
.row { font-family: var(--font-mono); font-size: 12.5px; color: var(--color-text-muted); margin: 4px 0; }
.unavailable { color: var(--color-text-dim); font-size: 13px; }
```

- [ ] **Step 2: Rewrite `frontend/src/components/StatusPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { fetchJSON } from "../api/client";
import styles from "./StatusPanel.module.css";

interface ActiveStatus {
  busy: boolean;
  now: string;
  chat: { activeCount: number; streams: Array<{ sessionId: string; preview?: string }> };
}

export function StatusPanel({ active }: { active: boolean }) {
  const [data, setData] = useState<ActiveStatus | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      const res = await fetchJSON<ActiveStatus>("/status/active");
      if (!cancelled && res.ok) setData(res.data);
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [active]);

  return (
    <div className={styles.panel}>
      <h2>Status</h2>
      {data ? (
        <div>
          <div className={styles.row}>Busy: {data.busy ? "yes" : "no"}</div>
          <div className={styles.row}>Active chat streams: {data.chat.activeCount}</div>
        </div>
      ) : (
        <div className={styles.unavailable}>Status unavailable.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/components/SettingsPanel.module.css`**

```css
.panel { padding: 18px 20px; }
.panel h2 { font-family: var(--font-display); font-size: 16px; margin: 0 0 12px; }
.panel h3 { font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-dim); margin: 16px 0 4px; }
.hint { color: var(--color-text-muted); font-size: 13px; margin: 0 0 10px; }
.list { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 4px; }
.list li { font-size: 13px; display: flex; align-items: center; gap: 8px; }
.addRow { display: flex; gap: 6px; }
```

- [ ] **Step 4: Rewrite `frontend/src/components/SettingsPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import styles from "./SettingsPanel.module.css";

const KEY = "jarvis.quickPhrases";

function load(): string[] {
  try { const raw = localStorage.getItem(KEY); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function save(phrases: string[]) {
  localStorage.setItem(KEY, JSON.stringify(phrases));
  document.dispatchEvent(new CustomEvent("jarvis:quick-phrases-changed", { detail: { phrases } }));
}

export function SettingsPanel() {
  const [phrases, setPhrases] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => { setPhrases(load()); }, []);

  const add = () => {
    if (!draft.trim()) return;
    const next = [...phrases, draft.trim()];
    setPhrases(next); save(next); setDraft("");
  };

  const remove = (idx: number) => {
    const next = phrases.filter((_, i) => i !== idx);
    setPhrases(next); save(next);
  };

  return (
    <div className={styles.panel}>
      <h2>Settings</h2>
      <h3>Quick phrases</h3>
      <p className={styles.hint}>Click to insert into the composer. Saved locally.</p>
      <ul className={styles.list}>
        {phrases.map((p, idx) => (
          <li key={idx}>
            {p} <button onClick={() => remove(idx)}>Remove</button>
          </li>
        ))}
      </ul>
      <div className={styles.addRow}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New quick phrase…" />
        <button onClick={add}>Add</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `frontend/src/components/SkillsManagePanel.module.css`**

```css
.panel { padding: 18px 20px; }
.panel h2 { font-family: var(--font-display); font-size: 16px; margin: 0 0 12px; }
.panel h3 { font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-dim); margin: 16px 0 4px; }
.empty { color: var(--color-text-dim); font-size: 13px; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
```

- [ ] **Step 6: Rewrite `frontend/src/components/SkillsManagePanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { fetchJSON } from "../api/client";
import styles from "./SkillsManagePanel.module.css";

interface Skill { name: string; hasUi: boolean; displayName?: string; description?: string; icon?: string; }

export function SkillsManagePanel() {
  const [installed, setInstalled] = useState<Skill[]>([]);
  const [initial, setInitial] = useState<Skill[]>([]);
  useEffect(() => {
    void fetchJSON<{ skills: Skill[] }>("/skills").then((r) => r.ok && setInstalled(r.data!.skills));
    void fetchJSON<{ skills: Skill[] }>("/skills/initial").then((r) => r.ok && setInitial(r.data!.skills));
  }, []);
  return (
    <div className={styles.panel}>
      <h2>Skills</h2>
      <h3>Installed</h3>
      {installed.length === 0 ? <div className={styles.empty}>No skills installed yet.</div> : (
        <ul className={styles.list}>{installed.map((s) => <li key={s.name}>{s.name}{s.hasUi ? " [ui]" : ""}</li>)}</ul>
      )}
      <h3>Template</h3>
      {initial.length === 0 ? <div className={styles.empty}>No template skills available.</div> : (
        <ul className={styles.list}>{initial.map((s) => <li key={s.name}>{s.name}{s.hasUi ? " [ui]" : ""}</li>)}</ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verify**

Run:
```bash
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: PASS. None of these three components have dedicated test files in the current suite (confirmed absent from the `find *.test.*` listing), so this step is the full regression check.

- [ ] **Step 8: Manual visual check**

Run `npm run dev:web`, navigate to Status, Settings, and Skills via the sidenav. Expected: all three use consistent padding/typography with the rest of the app instead of the old ad hoc inline `padding: 16`.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/StatusPanel.tsx frontend/src/components/StatusPanel.module.css frontend/src/components/SettingsPanel.tsx frontend/src/components/SettingsPanel.module.css frontend/src/components/SkillsManagePanel.tsx frontend/src/components/SkillsManagePanel.module.css
git commit -m "feat(frontend): re-skin Status/Settings/Skills panels, move off inline styles"
```

---

### Task 12: Copy pass

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`

**Context:** Per the spec's writing guidance (active voice, name things by what the user controls, consistent vocabulary). Most of the app already uses plain imperative labels (Send, Stop, Queue, Steer, Fork). The one clear gap is the header's "AA" button — an internal abbreviation ("auto-approve") a first-time user has no way to decode, unlike every other header button which is a plain word.

- [ ] **Step 1: Update the AA button's visible label in `frontend/src/components/ChatPanel.tsx`**

Change:
```tsx
            <button onClick={() => void chat.setAutoApprove(!ctx.state.autoApprove.effective)} disabled={!ctx.state.capabilities?.toolApprovals}>
              {ctx.state.autoApprove.effective ? "AA✓" : "AA"}
            </button>
```
to:
```tsx
            <button
              onClick={() => void chat.setAutoApprove(!ctx.state.autoApprove.effective)}
              disabled={!ctx.state.capabilities?.toolApprovals}
              title="Auto-approve tool calls"
            >
              {ctx.state.autoApprove.effective ? "Auto-approve ✓" : "Auto-approve"}
            </button>
```

- [ ] **Step 2: Check for any test asserting the old "AA" label**

Run:
```bash
cd frontend && grep -rn '"AA' src/
```
If `ChatPanel.test.tsx` or any other test asserts on the literal string `"AA"` or `"AA✓"`, update it to `"Auto-approve"` / `"Auto-approve ✓"` to match.

- [ ] **Step 3: Run the full frontend suite**

Run:
```bash
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx
git commit -m "fix(frontend): spell out Auto-approve instead of the AA abbreviation"
```

---

## Self-Review

**Spec coverage:**
- Color/typography tokens → Task 1.
- Sidenav/health dot → Task 2.
- Header Steer removal → Task 3.
- Composer responding-state action swap (the one real interaction change validated in the HTML prototype: inline Queue/Stop/Steer replacing Send, Steer gated by `busy`) → Task 4, plus the latent stale-`steerEnabled` bug this change surfaces → Task 5.
- Transcript re-skin (log-style user lines, tool cards, usage pills, empty state, chat header) → Tasks 6–7.
- InfoPanel / ApprovalModal re-skin → Task 8.
- TerminalDrawer retheme + inline-style cleanup (explicitly called out in the spec) → Task 10.
- Status/Settings/Skills re-skin → Task 11.
- Copy pass → Task 12 (scoped down to the one real gap found — "AA" — since the rest of the app's labels were already in reasonably plain active-voice form; inflating this into speculative rewrites of already-clear labels would violate YAGNI).
- `prefers-reduced-motion` handling → covered in Task 2 (only animated element left in scope, since the signature waveform is deferred).
- No signature/waveform element → explicitly not present in any task.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code; no "similar to Task N" references — Task 11's three panels are each given their own full code even though structurally similar, since an implementer may work them out of order.

**Type consistency:** `ComposerProps` unchanged across Tasks 4–5 (no new props introduced — `Composer` still receives `busy`/`steerEnabled`/`steerSupported`/`onQueue`/`onCancel`/`onToggleSteer` exactly as `ChatPanel.tsx` already passes them). `PastChatsMenuProps`, `StatusPanel`'s `{ active }`, and `SkillPanel`'s `{ name }` are untouched. `TerminalDrawer`'s `{ cwd, open, onClose }` props are untouched — only internal markup/theme changed.

**Scope check:** One subsystem (the frontend), bounded to a re-skin plus one relocated interaction — appropriately a single plan, not split into sub-project specs.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-frontend-quiet-signal.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
