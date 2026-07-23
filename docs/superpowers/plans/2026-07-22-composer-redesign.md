# Composer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `Composer.tsx` per `docs/superpowers/specs/2026-07-22-composer-redesign-design.md` — fix the Stage-2 audit findings and consolidate Steer, Auto-approve, and model selection (currently scattered across `ChatPanel`'s header and `InfoPanel`) into one turn-controls surface inside the Composer.

**Architecture:** `Composer.tsx` stays a pure props-in/callbacks-out component (no `ChatContext` access). Six new props (`models`, `currentModel`, `onModelChange`, `autoApproveEffective`, `autoApproveCapable`, `onAutoApproveToggle`) get re-threaded from `ChatPanelInner` (where the underlying state/handlers already exist today) into `<Composer>` instead of (Steer, Auto-approve) or in addition to (model) their current destination. The textarea grows with content via a `useLayoutEffect` measuring `scrollHeight`, capped at ~4 lines. The action row splits into a left "configuration" cluster (Attach, Model, Auto-approve) and a right "primary action" cluster (Send when idle; Stop+Queue+Steer coexisting when busy).

**Tech Stack:** React + TypeScript (Vite), Vitest + Testing Library, CSS Modules, the existing `Button` UI primitive (`frontend/src/components/ui/Button.tsx`).

## Global Constraints

- No changes to `ChatPatch`, `MessageEntry`, or any backend/API contract — purely presentational + prop re-threading (spec Non-goals).
- No slash commands, rich text editing, or fork/branch split-button.
- No responsive popover-collapse of the action row's left cluster — `flex-wrap` is the first pass (spec Non-goals, Edge Case 6).
- Textarea auto-resize caps at **~4 lines** (`TEXTAREA_MAX_HEIGHT_PX = 96`, i.e. `4 × 20px line-height + 2 × 8px vertical padding`) — deliberately tighter than the OSS precedents researched, not an oversight.
- Steer's button in the Composer renders only when `busy && steerSupported` (previously `steerSupported` alone) — this requires an auto-reset of `steerEnabled` to `false` on the `busy: true → false` transition in `ChatPanelInner`, or the state can go stale with no visible control to undo it (Edge Case 1 — "Steer-armed-then-idle trap").
- `Send` gets the same `disabled` treatment `Queue` already has: disabled when `text.trim() === "" && attachments.length === 0`.
- **Deliberate deviation from the spec's literal "all raw `<button>`s in `Composer.tsx` and `QuickPhrasesRow.tsx` move onto `Button`" wording:** `QuickPhrasesRow`'s pill/add/delete/overflow buttons stay bare `<button className={styles.x}>` elements, NOT wrapped in the `Button` primitive. Reason: `docs/frontend-components.md` already carves out an explicit exception for this exact component ("Not migrated: `QuickPhrasesRow`'s own pill... intentionally stays a bare `<span>`... forcing it through `Pill`'s generic `children`-only API would risk breaking the width measurement for no visual gain") — the same `ResizeObserver`-measured-clone coupling applies equally to wrapping these buttons in `Button`, since `Button`'s own border/padding/radius would need overriding anyway with no visual gain, and any mismatch between the real pill and its hidden measurement clone silently breaks the overflow-cutoff math. Only `Composer.tsx`'s own action-row buttons (Attach, Send, Stop, Queue, Steer, Auto-approve) migrate onto `Button`. This is documented in Task 6's doc update so the decision is visible, not silent.

---

## File Structure

- `frontend/src/components/Composer.tsx` — auto-resize textarea, new action-row markup (left/right clusters), new turn-control props, `Button` migration for its own buttons, a11y fixes.
- `frontend/src/components/Composer.module.css` — new `.textareaRow`/`.actionRow`/`.actionsLeft`/`.actionsRight`/`.modelSelect` classes, token cleanup, non-color `.warn` signal.
- `frontend/src/components/Composer.test.tsx` — extended with auto-resize, empty-input-disable, model/auto-approve wiring, Steer-visibility, and attach-aria-label tests.
- `frontend/src/components/QuickPhrasesRow.tsx` — overflow popup becomes a real, keyboard-operable `<button>` (was a hover-only `<div>`); container gets `role="group"`.
- `frontend/src/components/QuickPhrasesRow.module.css` — `.overflow`/`.overflowWrap` restyled for the click-driven (not hover-driven) popup.
- `frontend/src/components/QuickPhrasesRow.test.tsx` — extended with overflow keyboard-reachability, click-outside, Escape, and container-role tests.
- `frontend/src/components/ChatPanel.tsx` — delete header Steer/Auto-approve buttons; thread the six new props into `<Composer>`; add the Edge-Case-1 auto-reset `useEffect`.
- `frontend/src/components/ChatPanel.test.tsx` — header-toolbar test updated (6 buttons, not 8); new tests verifying model/auto-approve/steer wiring reaches the Composer.
- `frontend/src/components/InfoPanel.tsx` — delete the Model `<select>` row; `onModelChange` no longer threaded here (Auto-approve stays — it's a separate, still-valid control per the spec's Non-goals).
- `frontend/src/components/InfoPanel.test.tsx` — drop `onModelChange` from props/assertions.
- `docs/frontend-components.md` — update the `Button` migration note (Composer migrated; document the QuickPhrasesRow deviation above).
- `docs/design/redesign-phases.md` — mark Phase 4 "Done" with today's date and a link to this plan.

---

### Task 1: Composer — auto-resizing textarea + empty-input Send disable

**Files:**
- Modify: `frontend/src/components/Composer.tsx:1-5,30-35,124-126,160`
- Modify: `frontend/src/components/Composer.module.css:46`
- Test: `frontend/src/components/Composer.test.tsx`

**Interfaces:**
- Consumes: nothing new — works against `text`/`attachments` already in scope.
- Produces: `TEXTAREA_MAX_HEIGHT_PX` constant (96) used again by Task 3 when the file is further restructured. No prop signature changes in this task.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/Composer.test.tsx`, inside the existing `describe("<Composer>", ...)` block (after the last `it(...)`, before the closing `});`):

```tsx
  describe("empty-input handling", () => {
    it("disables Send when the composer is empty", () => {
      render(<Composer {...baseProps} />);
      expect(screen.getByText("Send")).toBeDisabled();
    });

    it("enables Send once there is text", () => {
      render(<Composer {...baseProps} />);
      const textarea = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(textarea, { target: { value: "hi" } });
      expect(screen.getByText("Send")).toBeEnabled();
    });

    it("enables Send when there are attachments even with empty text", () => {
      const attachments: ImageAttachment[] = [{ data: "abc", mimeType: "image/png", filename: "a.png" }];
      render(<Composer {...baseProps} attachments={attachments} />);
      expect(screen.getByText("Send")).toBeEnabled();
    });
  });

  describe("textarea auto-resize", () => {
    it("grows the textarea height with content, capped at the 4-line max", () => {
      render(<Composer {...baseProps} />);
      const textarea = screen.getByPlaceholderText(/type a message/i) as HTMLTextAreaElement;

      Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 60 });
      fireEvent.change(textarea, { target: { value: "line1\nline2" } });
      expect(textarea.style.height).toBe("60px");

      Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 300 });
      fireEvent.change(textarea, { target: { value: "line1\nline2\nline3\nline4\nline5" } });
      expect(textarea.style.height).toBe("96px");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/Composer.test.tsx`
Expected: FAIL — Send has no `disabled` attribute yet; `textarea.style.height` is never set (auto-resize doesn't exist yet).

- [ ] **Step 3: Implement auto-resize and the Send disable**

In `frontend/src/components/Composer.tsx`, change the import line and add the max-height constant right after the imports:

```tsx
import { useLayoutEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { ImageAttachment, UsageTotals } from "../api/types";
import { loadQuickPhrases, saveQuickPhrases } from "../state/quickPhrases";
import { QuickPhrasesRow } from "./QuickPhrasesRow";
import styles from "./Composer.module.css";

// ~4 lines at the textarea's 20px line-height + 16px vertical padding (2 × --space-4).
const TEXTAREA_MAX_HEIGHT_PX = 96;
```

Right after the line `const dragDepth = useRef(0);` (inside the `Composer` function body), add:

```tsx
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, [text]);
```

Change the textarea's `rows={2}` to `rows={1}` (the auto-resize effect now owns height, `rows` only sets the minimum starting point):

```tsx
        <textarea
          ref={textareaRef}
          rows={1}
```

Change the Send button to add the `disabled` prop:

```tsx
            <button type="submit" className="primary" disabled={!text.trim() && attachments.length === 0}>Send</button>
```

In `frontend/src/components/Composer.module.css`, replace:

```css
.row textarea { flex: 1; min-height: 40px; max-height: 200px; }
```

with:

```css
.row textarea {
  flex: 1;
  min-height: 40px;
  max-height: 96px;
  padding: var(--space-4);
  font-size: var(--font-size-5);
  font-family: inherit;
  line-height: 20px;
  resize: none;
  overflow-y: auto;
  box-sizing: border-box;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/Composer.test.tsx`
Expected: PASS (all tests, including the pre-existing ones — this task doesn't change any existing behavior other than the two edits above).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Composer.tsx frontend/src/components/Composer.module.css frontend/src/components/Composer.test.tsx
git commit -m "feat(frontend): auto-resize Composer textarea, disable Send when empty"
```

---

### Task 2: QuickPhrasesRow — keyboard/touch-reachable overflow popup

**Files:**
- Modify: `frontend/src/components/QuickPhrasesRow.tsx` (full rewrite — see below)
- Modify: `frontend/src/components/QuickPhrasesRow.module.css` (full rewrite — see below)
- Test: `frontend/src/components/QuickPhrasesRow.test.tsx`

**Interfaces:**
- Consumes: nothing new — same `QuickPhrasesRowProps` as today.
- Produces: no prop signature change. Behavior change only: the "+N" overflow indicator is now a real `<button>` (was a hover-only `<div>`), open/closed state is `overflowOpen` (was `overflowHovered`).

**Context on why this works in jsdom:** jsdom doesn't run real layout, so `offsetWidth`/`clientWidth` are always `0` in tests. Tracing the existing `recompute()` width-packing loop with all-zero widths: with exactly 2 phrases, both end up "visible" (the loop's last-item branch skips reserving overflow-indicator width); with 3+ phrases, only the first phrase is "visible" and the rest land in `hidden`/the overflow popup. This means a 3-phrase fixture reliably reproduces the overflow condition in tests without needing to mock layout.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/QuickPhrasesRow.test.tsx`, inside the existing `describe("<QuickPhrasesRow>", ...)` block (after the last `it(...)`, before the closing `});`):

```tsx
  it("has a group role and label on the container", () => {
    render(<QuickPhrasesRow phrases={["a"]} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Quick phrases" })).toBeInTheDocument();
  });

  describe("overflow popup", () => {
    // In jsdom all measured widths are 0, so with 3 phrases only the first
    // is "visible" and the rest ("b", "c") land in the overflow popup — see
    // the recompute() trace above.
    const phrases = ["a", "b", "c"];

    it("renders a real, focusable button (not a hover-only div) with aria-haspopup/aria-expanded", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: "2 more quick phrases" });
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle).toHaveAttribute("aria-haspopup", "true");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      toggle.focus();
      expect(toggle).toHaveFocus();
    });

    it("opens the popup on click and shows the hidden phrases", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      expect(screen.getByRole("button", { name: "2 more quick phrases" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "c" })).toBeInTheDocument();
    });

    it("submits a hidden phrase from the popup and closes it", () => {
      const onSubmit = vi.fn();
      render(<QuickPhrasesRow phrases={phrases} onSubmit={onSubmit} onAdd={vi.fn()} onDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      fireEvent.click(screen.getByRole("button", { name: "b" }));
      expect(onSubmit).toHaveBeenCalledWith("b");
      expect(screen.queryByRole("button", { name: "c" })).not.toBeInTheDocument();
    });

    it("deletes a hidden phrase from the popup without submitting it", () => {
      const onSubmit = vi.fn();
      const onDelete = vi.fn();
      render(<QuickPhrasesRow phrases={phrases} onSubmit={onSubmit} onAdd={vi.fn()} onDelete={onDelete} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove quick phrase: c" }));
      expect(onDelete).toHaveBeenCalledWith(2);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("closes on Escape", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("button", { name: "b" })).not.toBeInTheDocument();
    });

    it("closes on click-outside", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("button", { name: "b" })).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/QuickPhrasesRow.test.tsx`
Expected: FAIL — no `role="group"` on the container yet; the overflow indicator is a `<div>` with no accessible name/`aria-haspopup`, so `getByRole("button", { name: "2 more quick phrases" })` throws.

- [ ] **Step 3: Implement**

Replace the full contents of `frontend/src/components/QuickPhrasesRow.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./QuickPhrasesRow.module.css";

export interface QuickPhrasesRowProps {
  phrases: string[];
  onSubmit: (phrase: string) => void;
  onAdd: (phrase: string) => void;
  onDelete: (index: number) => void;
}

const GAP = 4;

export function QuickPhrasesRow({ phrases, onSubmit, onAdd, onDelete }: QuickPhrasesRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const addWrapRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const overflowWrapRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(phrases.length);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    const recompute = () => {
      const container = containerRef.current;
      const measure = measureRef.current;
      if (!container || !measure) return;
      const addWidth = addWrapRef.current?.offsetWidth ?? 0;
      const containerWidth = container.clientWidth - (addWidth ? addWidth + GAP : 0);
      const pillEls = Array.from(measure.querySelectorAll<HTMLElement>("[data-pill]"));
      const overflowEl = measure.querySelector<HTMLElement>("[data-overflow]");
      const overflowWidth = overflowEl ? overflowEl.offsetWidth : 0;

      let used = 0;
      let count = 0;
      for (let i = 0; i < pillEls.length; i++) {
        const w = pillEls[i].offsetWidth;
        const withGap = used === 0 ? w : used + GAP + w;
        const hasMore = i < pillEls.length - 1;
        const total = withGap + (hasMore ? GAP + overflowWidth : 0);
        if (i === 0 || total <= containerWidth) {
          used = withGap;
          count = i + 1;
        } else {
          break;
        }
      }
      setVisibleCount(count);
    };

    recompute();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [phrases, adding]);

  const closeOverflow = () => setOverflowOpen(false);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!overflowWrapRef.current?.contains(e.target as Node)) closeOverflow();
    };
    const onDocKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeOverflow();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [overflowOpen]);

  const openAdd = () => {
    setAdding(true);
    requestAnimationFrame(() => addInputRef.current?.focus());
  };

  const cancelAdd = () => {
    setAdding(false);
    setDraft("");
  };

  const commitAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      cancelAdd();
      return;
    }
    onAdd(trimmed);
    setDraft("");
  };

  const onAddKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAdd();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelAdd();
    }
  };

  const visible = phrases.slice(0, visibleCount);
  const hidden = phrases.slice(visibleCount);

  return (
    <div className={styles.row} ref={containerRef} role="group" aria-label="Quick phrases">
      <div className={styles.addWrap} ref={addWrapRef}>
        {adding ? (
          <input
            ref={addInputRef}
            className={styles.addInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onAddKeyDown}
            onBlur={cancelAdd}
            placeholder="New quick phrase…"
          />
        ) : (
          <button type="button" className={styles.addButton} onClick={openAdd} title="Add quick phrase" aria-label="Add quick phrase">
            +
          </button>
        )}
      </div>
      {visible.map((p, idx) => (
        <Pill key={idx} text={p} onSubmit={() => onSubmit(p)} onDelete={() => onDelete(idx)} />
      ))}
      {hidden.length > 0 && (
        <div
          className={styles.overflowWrap}
          ref={overflowWrapRef}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) closeOverflow();
          }}
        >
          <button
            type="button"
            className={styles.overflow}
            aria-haspopup="true"
            aria-expanded={overflowOpen}
            aria-label={`${hidden.length} more quick phrases`}
            onClick={() => setOverflowOpen((v) => !v)}
          >
            +{hidden.length}
          </button>
          {overflowOpen && (
            <div className={styles.overflowPopup}>
              <div className={styles.overflowPopupInner}>
                {hidden.map((p, idx) => (
                  <Pill
                    key={idx}
                    text={p}
                    onSubmit={() => { onSubmit(p); closeOverflow(); }}
                    onDelete={() => onDelete(visibleCount + idx)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {phrases.length > 0 && (
        <div className={styles.measure} ref={measureRef} aria-hidden="true">
          {phrases.map((p, idx) => (
            <div key={idx} data-pill className={styles.pill}>
              <span>{p}</span>
              <button type="button" tabIndex={-1} className={styles.delete}>×</button>
            </div>
          ))}
          <div data-overflow className={styles.overflow}>+{phrases.length}</div>
        </div>
      )}
    </div>
  );
}

function Pill({ text, onSubmit, onDelete }: { text: string; onSubmit: () => void; onDelete: () => void }) {
  return (
    <div className={styles.pill}>
      <button type="button" className={styles.pillText} onClick={onSubmit} title={text}>
        {text}
      </button>
      <button
        type="button"
        className={styles.delete}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label={`Remove quick phrase: ${text}`}
      >
        ×
      </button>
    </div>
  );
}
```

Replace the full contents of `frontend/src/components/QuickPhrasesRow.module.css`:

```css
.row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-2);
  position: relative;
}
.addWrap { flex-shrink: 0; }
.addButton {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  min-width: 0;
  padding: 0;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background: var(--color-surface-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-5);
  line-height: 1;
  cursor: pointer;
}
.addInput {
  height: 22px;
  min-width: 140px;
  font-size: var(--font-size-3);
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-2);
  color: var(--color-text);
}
.pill {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-5);
  font-size: var(--font-size-3);
  flex-shrink: 0;
  white-space: nowrap;
}
.pillText {
  background: none;
  border: none;
  padding: 0;
  min-width: 0;
  font-size: var(--font-size-3);
  color: var(--color-text);
  cursor: pointer;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.delete {
  background: none;
  border: none;
  padding: 0 var(--space-2);
  min-width: 0;
  line-height: 1;
  font-size: var(--font-size-4);
  color: var(--color-danger);
  cursor: pointer;
}
.overflowWrap {
  position: relative;
  display: flex;
  flex-shrink: 0;
}
.overflow {
  display: flex;
  align-items: center;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-4);
  font: inherit;
  font-size: var(--font-size-3);
  color: var(--color-text-muted);
  cursor: pointer;
}
.overflow:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.overflowPopup {
  position: absolute;
  bottom: 100%;
  right: 0;
  padding-bottom: var(--space-2);
  z-index: 10;
  min-width: 160px;
}
.overflowPopupInner {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
}
.overflowPopupInner .pill { width: 100%; }
.measure {
  position: absolute;
  visibility: hidden;
  height: 0;
  overflow: hidden;
  display: flex;
  gap: var(--space-2);
  white-space: nowrap;
  pointer-events: none;
  top: 0;
  left: 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/QuickPhrasesRow.test.tsx`
Expected: PASS (8 pre-existing tests + 7 new ones, 15 total).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/QuickPhrasesRow.tsx frontend/src/components/QuickPhrasesRow.module.css frontend/src/components/QuickPhrasesRow.test.tsx
git commit -m "fix(frontend): make QuickPhrasesRow's overflow popup keyboard/touch reachable"
```

---

### Task 3: Composer — consolidated action row (model, auto-approve, Steer visibility, Button migration)

**Files:**
- Modify: `frontend/src/components/Composer.tsx` (full rewrite — see below)
- Modify: `frontend/src/components/Composer.module.css` (full rewrite — see below)
- Test: `frontend/src/components/Composer.test.tsx`

**Interfaces:**
- Consumes: `Button` from `./ui/Button` (`variant?: "default" | "primary" | "danger"`, otherwise standard button props); `ModelInfo` from `../api/types` (`{ modelId: string; name: string }`).
- Produces: `ComposerProps` gains six new required props, consumed by Task 4's `<Composer>` call site in `ChatPanel.tsx`:

```ts
models: ModelInfo[];
currentModel?: string | null;
onModelChange: (modelId: string) => void;
autoApproveEffective: boolean;
autoApproveCapable: boolean;
onAutoApproveToggle: () => void;
```

- [ ] **Step 1: Write the failing tests**

First, update `baseProps` near the top of `frontend/src/components/Composer.test.tsx` to include the six new required props:

```tsx
const baseProps = {
  busy: false,
  steerEnabled: false,
  steerSupported: true,
  imagesSupported: true,
  attachments: [] as ImageAttachment[],
  models: [] as { modelId: string; name: string }[],
  currentModel: null as string | null,
  onModelChange: vi.fn(),
  autoApproveEffective: false,
  autoApproveCapable: true,
  onAutoApproveToggle: vi.fn(),
  onRemoveAttachment: vi.fn(),
  onAttachFiles: vi.fn(),
  onSend: vi.fn(),
  onSteer: noopAsync,
  onCancel: noopAsync,
  onQueue: noopAsync,
  onToggleSteer: vi.fn(),
};
```

Then append a new describe block (after the `describe("textarea auto-resize", ...)` block added in Task 1, before the file's closing):

```tsx
  describe("attach button", () => {
    it("has an accessible name via aria-label", () => {
      render(<Composer {...baseProps} />);
      expect(screen.getByRole("button", { name: "Attach image" })).toBeInTheDocument();
    });
  });

  describe("model selector", () => {
    const models = [
      { modelId: "m1", name: "Model One" },
      { modelId: "m2", name: "Model Two" },
    ];

    it("renders the provided models with the current one selected", () => {
      render(<Composer {...baseProps} models={models} currentModel="m2" />);
      const select = screen.getByLabelText("Model") as HTMLSelectElement;
      expect(select.value).toBe("m2");
      expect(screen.getByText("Model One")).toBeInTheDocument();
      expect(screen.getByText("Model Two")).toBeInTheDocument();
    });

    it("calls onModelChange when a different model is selected", () => {
      const onModelChange = vi.fn();
      render(<Composer {...baseProps} models={models} currentModel="m1" onModelChange={onModelChange} />);
      fireEvent.change(screen.getByLabelText("Model"), { target: { value: "m2" } });
      expect(onModelChange).toHaveBeenCalledWith("m2");
    });

    it("disables the selector when there are no models", () => {
      render(<Composer {...baseProps} models={[]} />);
      expect(screen.getByLabelText("Model")).toBeDisabled();
    });
  });

  describe("auto-approve toggle", () => {
    it("shows Auto-approve and calls onAutoApproveToggle when clicked", () => {
      const onAutoApproveToggle = vi.fn();
      render(<Composer {...baseProps} onAutoApproveToggle={onAutoApproveToggle} />);
      fireEvent.click(screen.getByRole("button", { name: "Auto-approve" }));
      expect(onAutoApproveToggle).toHaveBeenCalled();
    });

    it("shows a checkmark when effective", () => {
      render(<Composer {...baseProps} autoApproveEffective={true} />);
      expect(screen.getByText("✓ Auto-approve")).toBeInTheDocument();
    });

    it("is disabled when not capable", () => {
      render(<Composer {...baseProps} autoApproveCapable={false} />);
      expect(screen.getByRole("button", { name: "Auto-approve" })).toBeDisabled();
    });
  });

  describe("Steer visibility", () => {
    it("does not render Steer while idle, even when steerSupported", () => {
      render(<Composer {...baseProps} busy={false} steerSupported={true} />);
      expect(screen.queryByText("Steer")).not.toBeInTheDocument();
    });

    it("renders Steer while busy, when steerSupported", () => {
      render(<Composer {...baseProps} busy={true} steerSupported={true} />);
      expect(screen.getByText("Steer")).toBeInTheDocument();
    });

    it("does not render Steer while busy when steerSupported is false", () => {
      render(<Composer {...baseProps} busy={true} steerSupported={false} />);
      expect(screen.queryByText("Steer")).not.toBeInTheDocument();
    });
  });

  describe("context warning", () => {
    it("adds a non-color warning glyph once usage exceeds 80%", () => {
      render(
        <Composer
          {...baseProps}
          latestUsage={{
            requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
            context_limit: 1000, context_used: 900,
          }}
        />,
      );
      expect(screen.getByText(/⚠/)).toBeInTheDocument();
    });

    it("shows no warning glyph under 80% usage", () => {
      render(
        <Composer
          {...baseProps}
          latestUsage={{
            requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
            context_limit: 1000, context_used: 100,
          }}
        />,
      );
      expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/Composer.test.tsx`
Expected: FAIL with TypeScript errors (missing required props on `ComposerProps`) and/or missing-element errors (`getByLabelText("Model")`, `getByRole("button", { name: "Attach image" })`, `getByRole("button", { name: "Auto-approve" })`, `getByText("Steer")` gated on `busy`, `⚠` glyph) — none of this markup exists yet.

- [ ] **Step 3: Implement**

Replace the full contents of `frontend/src/components/Composer.tsx`:

```tsx
import { useLayoutEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { ImageAttachment, ModelInfo, UsageTotals } from "../api/types";
import { loadQuickPhrases, saveQuickPhrases } from "../state/quickPhrases";
import { QuickPhrasesRow } from "./QuickPhrasesRow";
import { Button } from "./ui/Button";
import styles from "./Composer.module.css";

// ~4 lines at the textarea's 20px line-height + 16px vertical padding (2 × --space-4).
const TEXTAREA_MAX_HEIGHT_PX = 96;

export interface ComposerProps {
  busy: boolean;
  steerEnabled: boolean;
  steerSupported: boolean;
  imagesSupported: boolean;
  attachments: ImageAttachment[];
  latestUsage?: UsageTotals;
  models: ModelInfo[];
  currentModel?: string | null;
  onModelChange: (modelId: string) => void;
  autoApproveEffective: boolean;
  autoApproveCapable: boolean;
  onAutoApproveToggle: () => void;
  onRemoveAttachment: (idx: number) => void;
  onAttachFiles: (files: File[]) => void;
  onSend: (text: string) => void;
  onSteer: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onQueue: (text: string) => Promise<void>;
  onToggleSteer: () => void;
}

export function Composer(props: ComposerProps) {
  const {
    busy, steerEnabled, steerSupported, imagesSupported,
    attachments, latestUsage,
    models, currentModel, onModelChange,
    autoApproveEffective, autoApproveCapable, onAutoApproveToggle,
    onRemoveAttachment, onAttachFiles,
    onSend, onSteer, onCancel, onQueue, onToggleSteer,
  } = props;
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [phrases, setPhrases] = useState<string[]>(() => loadQuickPhrases());
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, [text]);

  const dispatch = (trimmed: string) => {
    if (steerEnabled) void onSteer(trimmed);
    else if (busy) void onQueue(trimmed);
    else onSend(trimmed);
  };

  const submitPhrase = (phrase: string) => {
    dispatch(phrase.trim());
    textareaRef.current?.focus();
  };

  const addPhrase = (phrase: string) => {
    setPhrases((prev) => {
      const next = [...prev, phrase];
      saveQuickPhrases(next);
      return next;
    });
  };

  const deletePhrase = (idx: number) => {
    setPhrases((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      saveQuickPhrases(next);
      return next;
    });
  };

  const submit = (ev?: FormEvent) => {
    if (ev) ev.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    dispatch(trimmed);
    setText("");
  };

  const hasFiles = (ev: DragEvent) => Array.from(ev.dataTransfer.types).includes("Files");

  const onDragEnter = (ev: DragEvent) => {
    if (!imagesSupported || !hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragOver = (ev: DragEvent) => {
    if (!imagesSupported || !hasFiles(ev)) return;
    ev.preventDefault();
  };

  const onDragLeave = (ev: DragEvent) => {
    if (!imagesSupported || !hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (ev: DragEvent) => {
    if (!imagesSupported) return;
    ev.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(ev.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) onAttachFiles(files);
  };

  const isEmpty = !text.trim() && attachments.length === 0;
  const usagePct = latestUsage?.context_used != null && latestUsage?.context_limit
    ? latestUsage.context_used / latestUsage.context_limit
    : null;
  const isWarn = usagePct != null && usagePct > 0.8;

  return (
    <form
      className={dragging ? `${styles.form} ${styles.dragging}` : styles.form}
      onSubmit={submit}
      autoComplete="off"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && <div className={styles.dropOverlay}>Drop images to attach</div>}
      <div className={styles.attachments}>
        {attachments.map((img, idx) => (
          <div key={idx} className={styles.attachment}>
            <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.filename || "image"} />
            <span>{img.filename || `image ${idx + 1}`}</span>
            <button type="button" onClick={() => onRemoveAttachment(idx)} aria-label="remove">×</button>
          </div>
        ))}
      </div>
      <QuickPhrasesRow phrases={phrases} onSubmit={submitPhrase} onAdd={addPhrase} onDelete={deletePhrase} />
      <div className={styles.textareaRow}>
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={
            steerEnabled
              ? "Steer the running turn…"
              : busy
                ? "Queue a message for after this turn… (Enter to queue)"
                : "Type a message… (Shift+Enter for newline, Enter to send)"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            onAttachFiles(files);
            e.target.value = "";
          }}
        />
      </div>
      <div className={styles.actionRow}>
        <div className={styles.actionsLeft}>
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!imagesSupported}
            title="Attach image"
            aria-label="Attach image"
          >
            📎
          </Button>
          <select
            className={styles.modelSelect}
            value={currentModel ?? ""}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={models.length === 0}
            aria-label="Model"
          >
            {models.map((m) => (
              <option key={m.modelId} value={m.modelId}>{m.name || m.modelId}</option>
            ))}
          </select>
          <Button
            type="button"
            variant={autoApproveEffective ? "primary" : "default"}
            onClick={onAutoApproveToggle}
            disabled={!autoApproveCapable}
          >
            {autoApproveEffective ? "✓ Auto-approve" : "Auto-approve"}
          </Button>
        </div>
        <div className={styles.actionsRight}>
          {busy ? (
            <>
              <Button type="button" variant="danger" onClick={() => void onCancel()}>Stop</Button>
              <Button type="button" onClick={() => void onQueue(text)} disabled={!text.trim()}>Queue</Button>
              {steerSupported && (
                <Button type="button" variant={steerEnabled ? "primary" : "default"} onClick={onToggleSteer}>Steer</Button>
              )}
            </>
          ) : (
            <Button type="submit" variant="primary" disabled={isEmpty}>Send</Button>
          )}
        </div>
      </div>
      {latestUsage && latestUsage.context_limit != null && latestUsage.context_limit > 0 && (
        <div className={styles.contextBar}>
          <span>
            Context: {latestUsage.context_used?.toLocaleString() ?? "0"} /{" "}
            {latestUsage.context_limit.toLocaleString()}
            {" ("}
            <span className={isWarn ? styles.warn : undefined}>
              {isWarn ? "⚠ " : ""}
              {latestUsage.context_used != null
                ? Math.round((latestUsage.context_used / latestUsage.context_limit) * 100)
                : 0}
              %
            </span>
            {")"}
          </span>
          {latestUsage.cost && (
            <span> · ${latestUsage.cost.amount.toFixed(2)}</span>
          )}
        </div>
      )}
    </form>
  );
}
```

Replace the full contents of `frontend/src/components/Composer.module.css`:

```css
.form {
  position: relative;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-1);
  padding: var(--space-4) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  flex-shrink: 0;
}
.form.dragging {
  outline: 2px dashed var(--color-accent);
  outline-offset: -2px;
}
.dropOverlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-1);
  opacity: 0.92;
  font-size: var(--font-size-4);
  color: var(--color-text-muted);
  pointer-events: none;
}
.attachments { display: flex; gap: 6px; flex-wrap: wrap; }
.attachment {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  font-size: var(--font-size-3);
}
.attachment img {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 2px;
}
.textareaRow { display: flex; }
.textareaRow textarea {
  flex: 1;
  min-height: 40px;
  max-height: 96px;
  padding: var(--space-4);
  font-size: var(--font-size-5);
  font-family: inherit;
  line-height: 20px;
  resize: none;
  overflow-y: auto;
  box-sizing: border-box;
}
.actionRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
}
.actionsLeft {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.actionsRight {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}
.modelSelect {
  font: inherit;
  font-size: var(--font-size-4);
  background: var(--color-surface-2);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
}
.contextBar {
  font-size: var(--font-size-2);
  color: var(--color-text-muted);
  padding: var(--space-1) 0 0;
  display: flex;
  gap: var(--space-2);
}
.contextBar .warn { color: var(--color-warning); font-weight: var(--font-weight-semibold); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/Composer.test.tsx`
Expected: PASS (all tests from Task 1 plus the new ones from this task).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Composer.tsx frontend/src/components/Composer.module.css frontend/src/components/Composer.test.tsx
git commit -m "feat(frontend): consolidate model, auto-approve, and Steer into Composer's action row"
```

---

### Task 4: ChatPanel — remove header Steer/Auto-approve, thread new props, fix the Steer-armed-then-idle trap

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx:344-346` (new effect), `:483-498` (delete two buttons), `:535-549` (thread new props to `<Composer>`), `:552-568` (drop `onModelChange` from `<InfoPanel>`)
- Test: `frontend/src/components/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `Composer`'s six new props from Task 3; `ctx.state.models: ModelInfo[]`, `ctx.state.currentModel: string | null`, `ctx.state.autoApprove.effective: boolean`, `ctx.state.capabilities?.toolApprovals: boolean` (all already exist on `ChatState`); `onModelChange`/`onAutoApproveToggle` (already defined in `ChatPanelInner`, lines 315-324).
- Produces: nothing new for other tasks — this is the wiring task.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe("header toolbar", ...)` block in `frontend/src/components/ChatPanel.test.tsx` (currently lines 169-216) with:

```tsx
  describe("header toolbar", () => {
    it("renders 6 buttons with a divider separating primary and secondary groups — Steer and Auto-approve moved to the Composer", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel healthOk={null} />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByText("New chat")).toBeInTheDocument());

      // Primary group: New, Follow, Chats
      expect(screen.getByText("＋ New")).toBeInTheDocument();
      expect(screen.getByText("↓ Follow")).toBeInTheDocument();
      expect(screen.getByText("☰ Chats")).toBeInTheDocument();

      // Divider
      expect(document.querySelector('[class*="divider"]')).toBeInTheDocument();

      // Secondary group: Info, New in..., Fork
      expect(screen.getByText("Info")).toBeInTheDocument();
      expect(screen.getByText("+ New in...")).toBeInTheDocument();
      expect(screen.getByText("Fork")).toBeInTheDocument();
    });
  });

  describe("composer turn controls", () => {
    beforeEach(() => {
      fetchSpy.mockImplementation(async (url: string) => {
        if (String(url).startsWith("/chat/init")) {
          return {
            ok: true, status: 200, data: {
              ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" },
              sessionId: "sess-1", cwd: "/tmp/ws", resumed: false,
              capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: true, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false },
              slashCommands: [], history: [], pinned: false, group: null,
              autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
              model: { supported: true, available: [{ modelId: "m1", name: "Model One" }, { modelId: "m2", name: "Model Two" }], current: "m1" },
            },
          };
        }
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
        return { ok: true, status: 200, data: {} };
      });
    });

    it("renders the model selector and an auto-approve toggle inside the Composer", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel healthOk={null} />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByText("New chat")).toBeInTheDocument());
      expect(screen.getByLabelText("Model")).toBeInTheDocument();
      expect(screen.getByText("Model One")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Auto-approve" })).toBeInTheDocument();
    });

    it("calls /chat/model when a different model is selected in the Composer", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel healthOk={null} />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByLabelText("Model")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Model"), { target: { value: "m2" } });
      await waitFor(() =>
        expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith("/chat/model"))).toBe(true),
      );
    });

    it("does not show the Composer's Steer button while idle", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel healthOk={null} />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByText("New chat")).toBeInTheDocument());
      expect(screen.queryByText("Steer")).not.toBeInTheDocument();
    });
  });
```

**Note on Edge Case 1's auto-reset effect ("Steer-armed-then-idle trap"):** the spec's Testing section attributes this test to `Composer.test.tsx`, but the `steerEnabled` state the effect resets lives in `ChatPanelInner` (per the spec's own Edge Case 1 write-up), not in `Composer` — `Composer` only ever sees `steerEnabled` as a read-only prop. A true regression test would need to drive `chat.busy` through a real `true → false` transition, which in this codebase happens via `chat.sendMessage`'s SSE stream (`useChat.ts:61,87`) — there's no existing mock infrastructure in `ChatPanel.test.tsx` for simulating that stream (only `fetchJSON` is mocked today). Building that harness is out of scope for this plan. The three tests above cover the effect's *static* precondition (Steer only renders while busy) and the wiring; the dynamic transition itself should get a manual QA pass (start a turn, toggle Steer on, let the turn finish, confirm the next message goes through `onSend` not `onSteer`) before this ships.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx`
Expected: FAIL — the header still renders 8 buttons including "Steer"/"Auto-approve" text (breaking the rewritten "6 buttons" test's absence-of-those-texts expectations is implicit since we didn't assert their absence there, but TypeScript will fail first: `<Composer>` is missing the six new required props from Task 3, so the file won't compile); `getByLabelText("Model")` won't find anything since the Composer doesn't render a model select without props threaded.

- [ ] **Step 3: Implement**

In `frontend/src/components/ChatPanel.tsx`, add the Edge-Case-1 auto-reset effect right after the existing queue-drain effect (find this block, currently around line 335-342):

```tsx
  useEffect(() => {
    if (!chat.busy && queueRef.current) {
      const next = queueRef.current;
      queueRef.current = null;
      setAttachments([]);
      void chat.sendMessage(next);
    }
  }, [chat.busy, chat]);
```

Add immediately after it:

```tsx
  // Composer's Steer button now only renders while busy — if steerEnabled
  // stayed true across a turn ending, there'd be no visible control left to
  // turn it off, silently misrouting the next message through onSteer
  // instead of onSend. Auto-reset it whenever a turn is no longer busy.
  useEffect(() => {
    if (!chat.busy) setSteerEnabled(false);
  }, [chat.busy]);
```

Delete the header's Steer and Auto-approve buttons (currently lines 483-498):

```tsx
            <Button
              variant={steerEnabled ? "primary" : "default"}
              className={steerEnabled ? styles.toggleOn : undefined}
              onClick={() => setSteerEnabled((v) => !v)}
              disabled={!ctx.state.capabilities?.steer}
            >
              Steer
            </Button>
            <Button
              variant={ctx.state.autoApprove.effective ? "primary" : "default"}
              className={ctx.state.autoApprove.effective ? styles.toggleOn : undefined}
              onClick={onAutoApproveToggle}
              disabled={!ctx.state.capabilities?.toolApprovals}
            >
              {ctx.state.autoApprove.effective ? "✓ Auto-approve" : "Auto-approve"}
            </Button>
```

should be deleted entirely, leaving the `Fork` button immediately followed by the settings `<button>`.

Update the `<Composer>` call site (currently lines 535-549) to thread the six new props:

```tsx
          <Composer
            busy={chat.busy}
            steerEnabled={steerEnabled}
            steerSupported={!!ctx.state.capabilities?.steer}
            imagesSupported={!!ctx.state.capabilities?.images}
            attachments={attachments}
            latestUsage={latestUsage}
            models={ctx.state.models}
            currentModel={ctx.state.currentModel}
            onModelChange={onModelChange}
            autoApproveEffective={ctx.state.autoApprove.effective}
            autoApproveCapable={!!ctx.state.capabilities?.toolApprovals}
            onAutoApproveToggle={onAutoApproveToggle}
            onRemoveAttachment={onRemoveAttachment}
            onAttachFiles={onAttachFiles}
            onSend={onSend}
            onSteer={onSteerComposer}
            onCancel={async () => chat.cancel()}
            onQueue={onQueue}
            onToggleSteer={() => setSteerEnabled((v) => !v)}
          />
```

Update the `<InfoPanel>` call site to drop `onModelChange` (Auto-approve stays — it's still a separate, valid control in `InfoPanel`'s own "Overview" card, per the spec's Non-goals):

```tsx
          <InfoPanel
            state={ctx.state}
            title={ctx.state.title}
            group={ctx.state.group}
            groups={ctx.state.groups}
            pinned={ctx.state.pinned}
            usage={displayedUsage}
            usageQuerySupported={!!ctx.state.capabilities?.usageQuery}
            refreshingUsage={refreshingUsage}
            onRename={onRename}
            onGroup={onGroupChange}
            onAddGroup={onAddGroup}
            onPinned={onPinnedChange}
            onAutoApproveToggle={onAutoApproveToggle}
            onRefreshUsage={onRefreshUsage}
          />
```

(This won't fully compile until Task 5 removes `onModelChange` from `InfoPanelProps` — that's fine, Task 5 runs next and the two are intended to land together in review; if running strictly one-commit-at-a-time, it's acceptable for `tsc` to complain about an extra prop between Task 4 and Task 5's commits, since Task 5 immediately follows.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx`
Expected: still some failures until Task 5 also lands (TypeScript strictness on the `<InfoPanel>` call site) — proceed to Task 5 before doing a final verification run. Confirm at minimum that the new "composer turn controls" tests and the rewritten "header toolbar" test pass at the Vitest level (Vitest uses esbuild/SWC transpilation, not full `tsc`, so extra/missing-prop type errors won't fail the test run itself — only `npm run typecheck` will catch that, which Task 5 resolves).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/components/ChatPanel.test.tsx
git commit -m "feat(frontend): move Steer/Auto-approve out of ChatPanel's header into the Composer"
```

---

### Task 5: InfoPanel — remove the Model selector

**Files:**
- Modify: `frontend/src/components/InfoPanel.tsx:6-22` (prop interface), `:77-81` (destructure), `:166-173` (delete Model row)
- Test: `frontend/src/components/InfoPanel.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `InfoPanelProps` loses `onModelChange`. `state.models`/`state.currentModel` remain part of `ChatState` (unchanged) — `InfoPanel` simply stops reading them, since `state: ChatState` is still passed wholesale.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/InfoPanel.test.tsx`, remove `onModelChange: vi.fn(),` from `baseProps` (currently line 37):

```tsx
const baseProps = {
  state: baseState, title: "My chat", group: "", groups: [], pinned: false,
  onRename: vi.fn(), onGroup: vi.fn(), onAddGroup: vi.fn(), onPinned: vi.fn(),
  onAutoApproveToggle: vi.fn(),
};
```

Update the first test (currently lines 41-47) to drop the model assertion:

```tsx
  it("renders session id, cwd, and slash count", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ws")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
```

Add a new test confirming the Model row is gone:

```tsx
  it("no longer renders a model selector — it moved to the Composer", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.queryByText("Model One")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: FAIL — TypeScript error on `baseProps` (still expects `onModelChange` to be a valid/no-longer-required prop is fine, but the *new* "no longer renders" test fails because `<select>` with "Model One" still renders today).

- [ ] **Step 3: Implement**

In `frontend/src/components/InfoPanel.tsx`, remove `onModelChange` from the props interface:

```tsx
export interface InfoPanelProps {
  state: ChatState;
  title: string;
  group: string;
  groups: string[];
  pinned: boolean;
  usage?: UsageTotals;
  usageQuerySupported?: boolean;
  refreshingUsage?: boolean;
  onRename: (t: string) => void;
  onGroup: (g: string) => void;
  onAddGroup: (name: string) => Promise<void>;
  onPinned: (p: boolean) => void;
  onAutoApproveToggle: () => void;
  onRefreshUsage?: () => void;
}
```

Remove `onModelChange` from the destructure:

```tsx
  const {
    state, title, group, groups, pinned, usage, usageQuerySupported, refreshingUsage,
    onRename, onGroup, onAddGroup, onPinned, onAutoApproveToggle, onRefreshUsage,
  } = props;
```

Delete the Model row (currently):

```tsx
        <div className={styles.row}>
          <span className={styles.key}>Model</span>
          <select value={state.currentModel ?? ""} onChange={(e) => onModelChange(e.target.value)} disabled={state.models.length === 0}>
            {state.models.map((m) => (
              <option key={m.modelId} value={m.modelId}>{m.name || m.modelId}</option>
            ))}
          </select>
        </div>
```

leaving the "Overview" card's Workspace row immediately followed by the Auto-approve row.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx src/components/ChatPanel.test.tsx`
Expected: PASS on both files now that `<InfoPanel>`'s call site in `ChatPanel.tsx` (Task 4) matches the trimmed `InfoPanelProps`.

Then run the full frontend suite and typecheck to confirm nothing else references the removed prop:

Run: `cd frontend && npx vitest run && npm run typecheck`
Expected: PASS. (`frontend/package.json`'s own `typecheck` script is `tsc --noEmit` — separate from the repo root's `npm run typecheck`, which only covers the backend.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.test.tsx
git commit -m "refactor(frontend): remove InfoPanel's model selector — moved to Composer"
```

---

### Task 6: Docs sync — Button migration note, Phase 4 marked Done

**Files:**
- Modify: `docs/frontend-components.md`
- Modify: `docs/design/redesign-phases.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the Button migration note**

In `docs/frontend-components.md`, replace:

```
Renders with `--radius-md` (4px rounding), smooth hover/focus transitions, a
`--color-accent` focus-visible ring, and a subtle `:active` scale press. First adopted by
`ChatPanel`'s header toolbar (Phase 3: Header/Toolbar Cleanup). `InfoPanel`/`Composer` still
use raw `<button>` — migrate onto `Button` whenever those files are next touched, rather
than as a standalone sweep.
```

with:

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
```

- [ ] **Step 2: Mark Phase 4 Done**

In `docs/design/redesign-phases.md`, replace:

```
## Phase 4: Composer Redesign — In progress (2026-07-22)

Scoped to `Composer` only — the Info Panel half of the original "Composer + Info Panel Audit"
entry remains deferred (not raised as a pain point, no audit run against it yet). A Stage 2
heuristic audit of `Composer` found one critical accessibility bug (quick-phrases overflow
unreachable by keyboard/touch), four major issues, and several minor ones; this phase also
relocates Steer, Auto-approve, and model selection into the Composer as one consolidated
turn-controls surface.

- Spec: `docs/superpowers/specs/2026-07-22-composer-redesign-design.md`
```

with (update the date on the second line to whatever date this task actually lands — use the real date, not a placeholder):

```
## Phase 4: Composer Redesign — Done (2026-07-22)

Scoped to `Composer` only — the Info Panel half of the original "Composer + Info Panel Audit"
entry remains deferred (not raised as a pain point, no audit run against it yet). Fixed the
critical accessibility bug (quick-phrases overflow, now a real keyboard/touch-operable
button), the four major issues (color-only context warning, no persistent send-mode
indicator, inconsistent empty-input handling, missing attach `aria-label`), and the minor
ones (raw `<button>`s in `Composer.tsx` migrated onto `Button`, hardcoded px values onto
tokens, auto-resizing textarea capped at ~4 lines). Relocated Steer and Auto-approve out of
`ChatPanel`'s header, and the model selector out of `InfoPanel`, into one consolidated
turn-controls action row in the Composer.

- Spec: `docs/superpowers/specs/2026-07-22-composer-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-07-22-composer-redesign.md`
```

- [ ] **Step 3: Commit**

```bash
git add docs/frontend-components.md docs/design/redesign-phases.md
git commit -m "docs: mark Phase 4 (Composer Redesign) done, update Button migration note"
```

---

## Final verification

After all six tasks, from the repo root:

```bash
npm run test:web
```

Expected: all frontend tests pass, including every new test added across Tasks 1-5.

```bash
cd frontend && npm run typecheck
```

Expected: no type errors (confirms the `InfoPanelProps`/`ComposerProps` changes are fully consistent across `ChatPanel.tsx`, `Composer.tsx`, and `InfoPanel.tsx`).
