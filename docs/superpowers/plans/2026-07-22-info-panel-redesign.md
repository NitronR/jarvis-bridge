# Info Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure and restyle `frontend/src/components/InfoPanel.tsx` from four uniform
bordered cards into three typography-driven sections (Chat identity → Usage → Session &
workspace), per `docs/superpowers/specs/2026-07-22-info-panel-redesign-design.md`.

**Architecture:** Pure presentational change to one component + its stylesheet + its test
file, plus a small, forced prop-shape cleanup in `ChatPanel.tsx` (the two props `InfoPanel`
gives up). No state/context/backend changes. Work proceeds structure-first (remove dead props,
reorder/merge sections, add the click-to-edit title, add the usage meter), then visual
polish (remove card chrome), then primitive migration (raw `<button>` → `Button`), then docs.

**Tech Stack:** React 18 + TypeScript (strict), CSS Modules, Vitest + Testing Library.

## Global Constraints

- No new design tokens — use only existing `--space-*`, `--font-size-*`, `--color-*`,
  `--radius-*` custom properties from `frontend/src/styles/tokens.css`.
- No new shared `ui/` primitive for the usage meter — it has exactly one consumer
  (`InfoPanel`) today; build it as local CSS in `InfoPanel.module.css`.
- No color-only status signals — every `.warn` state needs a non-color cue too (bold weight +
  a `⚠` glyph, matching the precedent already set for `Composer`'s context warning).
- No changes to `ChatState`, `UsageTotals`, or any backend/API contract.
- No changes to `Composer.tsx` or `ChatPanel.tsx`'s header buttons/layout — only the one-line
  prop-passing removal in `ChatPanel.tsx` described in Task 1.
- Run `cd frontend && npm run test:web` (or `npx vitest run src/components/InfoPanel.test.tsx`
  for a fast loop) after every task.

---

### Task 1: Remove Model Selector & Auto-Approve Toggle

`InfoPanel` gives up the Model selector and Auto-approve toggle — both are moving to
`Composer` under a separate, not-yet-implemented spec (Phase 4). This task only removes them
from `InfoPanel` and un-threads the two now-dead props, so later tasks build on a clean
`InfoPanelProps` shape.

**Files:**
- Modify: `frontend/src/components/InfoPanel.tsx`
- Modify: `frontend/src/components/InfoPanel.test.tsx`
- Modify: `frontend/src/components/ChatPanel.tsx:315-320,565-566`

**Interfaces:**
- Produces: `InfoPanelProps` with `onModelChange` and `onAutoApproveToggle` removed — every
  later task's edits to `InfoPanel.tsx` assume these two fields are already gone.

- [ ] **Step 1: Update the test file to assert the Model selector and Auto-approve toggle are gone**

In `frontend/src/components/InfoPanel.test.tsx`, remove `onModelChange: vi.fn(),
onAutoApproveToggle: vi.fn(),` from `baseProps` (lines 34-38 today):

```ts
const baseProps = {
  state: baseState, title: "My chat", group: "", groups: [], pinned: false,
  onRename: vi.fn(), onGroup: vi.fn(), onAddGroup: vi.fn(), onPinned: vi.fn(),
};
```

Replace the `"renders session id, cwd, slash count, model"` test with one that no longer
expects a model selector:

```ts
  it("renders session id, cwd, and slash count", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ws")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByLabelText(/model/i)).not.toBeInTheDocument();
  });
```

Delete the `"calls onAutoApproveToggle when the toggle is clicked"` test entirely and replace
it with an absence check:

```ts
  it("does not render an auto-approve toggle", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.queryByTestId("auto-approve-toggle")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and confirm the new/changed assertions fail**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: FAIL — `queryByLabelText(/model/i)` finds the `<select>` (not null), and
`queryByTestId("auto-approve-toggle")` finds the toggle button (not null).

- [ ] **Step 3: Remove the Model selector and Auto-approve toggle from `InfoPanel.tsx`**

In `InfoPanel.tsx`, remove these two fields from `InfoPanelProps` (currently lines 19-20):

```ts
  onModelChange: (modelId: string) => void;
  onAutoApproveToggle: () => void;
```

Remove `onModelChange, onAutoApproveToggle,` from the destructure in the `InfoPanel` function
body (currently line 80).

Delete these two `.row` blocks from inside the "Overview" card (currently lines 166-184):

```tsx
        <div className={styles.row}>
          <span className={styles.key}>Model</span>
          <select value={state.currentModel ?? ""} onChange={(e) => onModelChange(e.target.value)} disabled={state.models.length === 0}>
            {state.models.map((m) => (
              <option key={m.modelId} value={m.modelId}>{m.name || m.modelId}</option>
            ))}
          </select>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Auto-approve</span>
          <button
            type="button"
            data-testid="auto-approve-toggle"
            className={state.autoApprove.effective ? "primary" : ""}
            onClick={onAutoApproveToggle}
          >
            {state.autoApprove.effective ? "On" : "Off"}
          </button>
        </div>
```

The "Overview" card now contains only the Workspace row — leave it as-is for now (Task 2
merges it into "Session & workspace").

- [ ] **Step 4: Remove the dead `onModelChange` callback and un-thread both props in `ChatPanel.tsx`**

In `ChatPanel.tsx`, delete the now-fully-unused `onModelChange` callback (currently lines
315-320):

```ts
  const onModelChange = useCallback(
    (modelId: string) => {
      void chat.setModel(modelId);
    },
    [chat],
  );

```

(`onAutoApproveToggle`, defined right after this block, stays — it's still used by the
header's own Auto-approve button.)

In the `<InfoPanel>` call site (currently lines 552-568), delete these two lines:

```tsx
            onModelChange={onModelChange}
            onAutoApproveToggle={onAutoApproveToggle}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Typecheck and run the full frontend test suite**

Run: `cd frontend && npx tsc --noEmit && npm run test:web`
Expected: PASS — this catches any other reference to the removed `onModelChange` (there
should be none; `ChatPanel.test.tsx` was confirmed to have no model-related assertions).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.test.tsx frontend/src/components/ChatPanel.tsx
git commit -m "refactor(frontend): drop Model selector and Auto-approve toggle from InfoPanel"
```

---

### Task 2: Reorder & Merge Sections

Reorders the three remaining cards to Chat identity → Usage → Session & workspace, and
merges the old "Overview" (now just Workspace) and "Session" cards into one "Session &
workspace" card, per the spec's Content Structure & Order section.

**Files:**
- Modify: `frontend/src/components/InfoPanel.tsx`
- Modify: `frontend/src/components/InfoPanel.test.tsx`

**Interfaces:**
- Consumes: `InfoPanelProps` from Task 1 (no `onModelChange`/`onAutoApproveToggle`).
- Produces: three `<h3>` headings in DOM order `"Current chat"`, `"Usage"` (when rendered),
  `"Session & workspace"` — later tasks (3-6) style and instrument these same three cards but
  don't change their order or which fields live in which card.

- [ ] **Step 1: Write a failing test asserting the new heading order and the merged card**

Add to `InfoPanel.test.tsx`:

```ts
  it("renders cards in Chat identity -> Usage -> Session & workspace order", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { five_hour: { status: "allowed", utilization: 0.12 } },
        }}
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Current chat", "Usage", "Session & workspace"]);
  });

  it("merges workspace, session id, and slash count under one Session & workspace card", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Session")).not.toBeInTheDocument();
    expect(screen.getByText("Session & workspace")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ws")).toBeInTheDocument();
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: FAIL — today's heading order is `["Current chat", "Overview", "Session", "Usage"]`
and there's no "Session & workspace" heading.

- [ ] **Step 3: Reorder and merge the cards in `InfoPanel.tsx`**

Replace the whole block from the "Overview" card's opening tag through the end of the
"Session" card's closing tag, and move the "Usage" card above it. The `<aside
className={styles.panel}>`'s children become, in order:

```tsx
      <div className={styles.card}>
        <h3>Current chat</h3>
        <div className={styles.row}>
          <span className={styles.key}>Title</span>
          <div className={styles.titleField}>
            <input
              placeholder="Untitled"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); }}
            />
            <button
              type="button"
              className={styles.saveButton}
              aria-label="Save title"
              title="Save title"
              disabled={!titleDirty}
              onClick={saveTitle}
            >
              <SaveIcon />
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <label className={styles.key} htmlFor="group-select">Group</label>
          <select
            id="group-select"
            value={group || ""}
            onChange={(e) => handleGroupChange(e.target.value)}
          >
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
            <option value="__add_group__">+ Add Group…</option>
          </select>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Pinned</span>
          <button
            type="button"
            className={`${styles.pinButton} ${pinned ? styles.pinButtonActive : ""}`}
            onClick={() => onPinned(!pinned)}
            aria-label={pinned ? "Unpin session" : "Pin session"}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 2l-1.5 4 5 5 4-1.5v3l-5 1.5-3.5 6.5L13 17l-6 6-1.5-1.5 6-6-3.5-2.5L9.5 8 8 3h3L9.5 7.5l4 4 4-5.5L16 2z" />
            </svg>
          </button>
        </div>
      </div>

      {(usageQuerySupported || (usage && (usage.rate_limits || usage.cost))) && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h3>Usage</h3>
            {usageQuerySupported && (
              <button
                type="button"
                className={styles.refreshButton}
                aria-label="Refresh usage"
                title="Refresh usage"
                disabled={refreshingUsage}
                onClick={onRefreshUsage}
              >
                <RefreshIcon spinning={refreshingUsage} />
              </button>
            )}
          </div>
          {usage?.rate_limits &&
            Object.entries(usage.rate_limits).map(([type, w]) => {
              const pct = typeof w.utilization === "number" ? Math.round(w.utilization * 100) : null;
              const resets = formatResetsAt(w.resetsAt, w.resetsAtText);
              return (
                <div key={type}>
                  <div className={styles.row}>
                    <span className={styles.key}>{rateLimitLabel(type)}</span>
                    <span className={`${styles.val} ${pct != null && pct >= 80 ? styles.warn : ""}`}>
                      {pct != null ? `${pct}%` : w.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  {resets && <div className={styles.resetNote}>resets {resets}</div>}
                </div>
              );
            })}
          {usage?.cost && (
            <div className={styles.row}>
              <span className={styles.key}>Session cost</span>
              <span className={styles.val}>${usage.cost.amount.toFixed(2)}</span>
            </div>
          )}
          {usageQuerySupported && !usage?.rate_limits && (
            <div className={styles.row}>
              <span className={styles.key}>—</span>
              <span className={styles.val}>tap refresh</span>
            </div>
          )}
        </div>
      )}

      <div className={styles.card}>
        <h3>Session & workspace</h3>
        <div className={styles.row}>
          <span className={styles.key}>Workspace</span>
          <span className={styles.val}>{state.cwd ?? "—"}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>ID</span>
          <span className={styles.val}>{state.sessionId ?? "—"}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Slash cmds</span>
          <span className={styles.val}>{state.slashCommands.length}</span>
        </div>
      </div>
```

(This is a pure reorder/merge — the Title/Group/Pinned markup is copied unchanged from
today's "Current chat" card; Task 3 replaces the Title block specifically.)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.test.tsx
git commit -m "refactor(frontend): reorder InfoPanel to Chat identity -> Usage -> Session & workspace"
```

---

### Task 3: Click-to-Edit Title

Replaces the always-visible title `<input>` + save button with click-to-edit: static text by
default, an inline input while editing, keyboard-operable per the spec's Accessibility
section.

**Files:**
- Modify: `frontend/src/components/InfoPanel.tsx`
- Modify: `frontend/src/components/InfoPanel.test.tsx`

**Interfaces:**
- Consumes: `onRename: (t: string) => void` (unchanged prop from `InfoPanelProps`).
- Produces: no new props. Internal state only (`titleDraft: string`, `editingTitle: boolean`).

- [ ] **Step 1: Replace the old title tests with click-to-edit tests**

In `InfoPanel.test.tsx`, delete these four existing tests (they assume an always-visible
input, which no longer exists): `"does not call onRename while typing, only on save"`,
`"calls onRename when Enter is pressed in the title input"`,
`"disables the save button until the title is edited"`,
`"resets the draft title when the title prop changes externally"`.

Replace them with:

```ts
  it("renders the title as static text by default, not an input", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByText("My chat")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an accessible edit affordance for the title", () => {
    render(<InfoPanel {...baseProps} />);
    const trigger = screen.getByLabelText("Edit title");
    expect(trigger).toHaveAttribute("role", "button");
    expect(trigger).toHaveAttribute("tabIndex", "0");
  });

  it("enters edit mode on click and commits the new title on Enter", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    const input = screen.getByDisplayValue("My chat");
    fireEvent.change(input, { target: { value: "new title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("new title");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("enters edit mode via keyboard (Enter or Space on the trigger)", () => {
    render(<InfoPanel {...baseProps} />);
    fireEvent.keyDown(screen.getByLabelText("Edit title"), { key: "Enter" });
    expect(screen.getByDisplayValue("My chat")).toBeInTheDocument();
  });

  it("commits the new title on blur", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    const input = screen.getByDisplayValue("My chat");
    fireEvent.change(input, { target: { value: "blurred title" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("blurred title");
  });

  it("reverts without committing on Escape", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    const input = screen.getByDisplayValue("My chat");
    fireEvent.change(input, { target: { value: "discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("My chat")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not call onRename when the committed value is unchanged", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    fireEvent.keyDown(screen.getByDisplayValue("My chat"), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("commits an empty title", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    const input = screen.getByDisplayValue("My chat");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("");
  });
```

- [ ] **Step 2: Run the tests and confirm the new ones fail**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: FAIL — `getByLabelText("Edit title")` finds nothing yet; the always-visible input
still renders instead.

- [ ] **Step 3: Remove the `useEffect` title-sync and the `SaveIcon`/save-button plumbing**

In `InfoPanel.tsx`, change the import line (currently line 1) since `useEffect` is no longer
used anywhere in this file once the sync effect below is removed:

```ts
import { useState } from "react";
```

Delete the `SaveIcon` function (currently lines 56-63) — it has no other caller.

- [ ] **Step 4: Replace the title state and handlers**

Replace this block (currently lines 82-85):

```ts
  const [titleDraft, setTitleDraft] = useState(title);
  useEffect(() => setTitleDraft(title), [title]);
  const titleDirty = titleDraft !== title;
  const saveTitle = () => { if (titleDirty) onRename(titleDraft); };
```

with:

```ts
  const [titleDraft, setTitleDraft] = useState(title);
  const [editingTitle, setEditingTitle] = useState(false);
  const openTitleEdit = () => { setTitleDraft(title); setEditingTitle(true); };
  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft !== title) onRename(titleDraft);
  };
  const revertTitle = () => setEditingTitle(false);
```

- [ ] **Step 5: Replace the Title row's markup**

Replace the Title `.row` block written in Task 2 (the `<input>` + `SaveIcon` button pair)
with:

```tsx
        <div className={styles.row}>
          <span className={styles.key}>Title</span>
          {editingTitle ? (
            <input
              className={styles.titleInput}
              aria-label="Title"
              placeholder="Untitled"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") revertTitle();
              }}
              onBlur={commitTitle}
            />
          ) : (
            <span
              className={styles.titleDisplay}
              role="button"
              tabIndex={0}
              aria-label="Edit title"
              onClick={openTitleEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openTitleEdit();
                }
              }}
            >
              {title || "Untitled"}
              <span className={styles.titlePencil} aria-hidden="true">✎</span>
            </span>
          )}
        </div>
```

- [ ] **Step 6: Add minimal styling so the input doesn't visually jump when swapping in**

In `InfoPanel.module.css`, add:

```css
.titleDisplay {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
  font-size: var(--font-size-4);
}
.titlePencil {
  opacity: 0;
  color: var(--color-text-muted);
  transition: opacity 120ms ease;
}
.titleDisplay:hover .titlePencil,
.titleDisplay:focus .titlePencil {
  opacity: 1;
}
.titleInput {
  font-size: var(--font-size-4);
  flex: 1;
  min-width: 0;
}
```

(Task 5 revisits these values once the title's overall type scale is finalized as part of the
broader typographic hierarchy — this step only needs the input/display pair to not look
broken in the meantime.)

Remove the now-unused `.titleField`, `.saveButton`, and `.saveButton svg` rules (currently
lines 67-88 in `InfoPanel.module.css`) — nothing references them once `SaveIcon` and its
wrapper are gone.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (confirms the `useEffect` import removal didn't break anything else in this
file)

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.module.css frontend/src/components/InfoPanel.test.tsx
git commit -m "feat(frontend): click-to-edit title in InfoPanel"
```

---

### Task 4: Usage Meter + Non-Color Warning Signal

Adds a progress-bar meter next to each rate-limit percentage, and fixes the color-only ≥80%
warning by adding a `⚠` prefix + bold weight alongside the existing color change.

**Files:**
- Modify: `frontend/src/components/InfoPanel.tsx`
- Modify: `frontend/src/components/InfoPanel.module.css`
- Modify: `frontend/src/components/InfoPanel.test.tsx`

**Interfaces:**
- Consumes: `usage?.rate_limits` (unchanged `UsageTotals` type — no contract change).
- Produces: no new props; purely additive markup/CSS around the existing rate-limit loop.

- [ ] **Step 1: Write failing tests for the meter and the warning glyph**

Add to `InfoPanel.test.tsx`:

```ts
  it("renders a progressbar with the correct value for each rate-limit window", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { five_hour: { status: "allowed", utilization: 0.12 } },
        }}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: /session \(5h\) usage/i });
    expect(bar).toHaveAttribute("aria-valuenow", "12");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("does not render a progressbar for a window with no numeric utilization", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { overage: { status: "rejected" } },
        }}
      />,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("prefixes the percentage with a warning glyph at >=80%, not just a color change", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { seven_day: { status: "allowed_warning", utilization: 0.86 } },
        }}
      />,
    );
    expect(screen.getByText("⚠ 86%")).toBeInTheDocument();
  });

  it("does not prefix the percentage with a warning glyph below 80%", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { five_hour: { status: "allowed", utilization: 0.12 } },
        }}
      />,
    );
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and confirm the new ones fail**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: FAIL — no `progressbar` role rendered yet, and the percentage text has no `⚠`
prefix at 86%.

- [ ] **Step 3: Add the meter and warning glyph to the rate-limit loop**

Replace the rate-limit `.map` body (written in Task 2) with:

```tsx
          {usage?.rate_limits &&
            Object.entries(usage.rate_limits).map(([type, w]) => {
              const pct = typeof w.utilization === "number" ? Math.round(w.utilization * 100) : null;
              const isWarn = pct != null && pct >= 80;
              const resets = formatResetsAt(w.resetsAt, w.resetsAtText);
              const label = rateLimitLabel(type);
              return (
                <div key={type}>
                  <div className={styles.row}>
                    <span className={styles.key}>{label}</span>
                    <span className={`${styles.val} ${isWarn ? styles.warn : ""}`}>
                      {pct != null ? `${isWarn ? "⚠ " : ""}${pct}%` : w.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  {pct != null && (
                    <div
                      className={styles.meterTrack}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${label} usage`}
                    >
                      <div
                        className={`${styles.meterFill} ${isWarn ? styles.meterFillWarn : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  {resets && <div className={styles.resetNote}>resets {resets}</div>}
                </div>
              );
            })}
```

- [ ] **Step 4: Add the meter styles**

In `InfoPanel.module.css`, add:

```css
.meterTrack {
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
  overflow: hidden;
  margin: var(--space-2) 0 var(--space-4);
}
.meterFill {
  height: 100%;
  background: var(--color-success);
}
.meterFillWarn {
  background: var(--color-warning);
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.module.css frontend/src/components/InfoPanel.test.tsx
git commit -m "feat(frontend): add usage meters and non-color warning signal to InfoPanel"
```

---

### Task 5: Visual Language — Remove Card Chrome, Hairline Dividers, Typography

Pure CSS pass: removes the boxed-card look, replaces it with hairline section dividers and a
typographic hierarchy (larger title, small uppercase section labels), per the spec's Visual
Language section. No JSX structure changes beyond swapping `className`s — DOM roles/text
content are unaffected, so no existing test should need updating for this task.

**Files:**
- Modify: `frontend/src/components/InfoPanel.tsx`
- Modify: `frontend/src/components/InfoPanel.module.css`

**Interfaces:**
- Consumes: the three-section JSX structure from Tasks 2-4.
- Produces: `.section`/`.sectionLabel`/`.sectionLabelRow` class names — Task 6 reuses
  `.sectionLabelRow` as the flex container for the Usage label + refresh button.

- [ ] **Step 1: Confirm the current test suite passes before this purely-visual change**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: PASS (baseline before touching CSS/classNames)

- [ ] **Step 2: Swap `.card`/`.cardHeader` classNames for `.section`/`.sectionLabelRow` in `InfoPanel.tsx`**

Replace every `<div className={styles.card}>` (three occurrences, one per section) with
`<div className={styles.section}>`.

Replace the Usage card's heading block:

```tsx
          <div className={styles.cardHeader}>
            <h3>Usage</h3>
            {usageQuerySupported && (
```

with:

```tsx
          <div className={styles.sectionLabelRow}>
            <h3>Usage</h3>
            {usageQuerySupported && (
```

- [ ] **Step 3: Replace the card/typography rules in `InfoPanel.module.css`**

Replace the `.card`, `.card h3`, `.cardHeader`, `.cardHeader h3` rules (currently lines 6-25)
with:

```css
.section {
  padding: var(--space-8) 0;
  border-top: 1px solid var(--color-border);
}
.section:first-child {
  border-top: none;
  padding-top: 0;
}
.section h3 {
  margin: 0 0 var(--space-6);
  font-size: var(--font-size-1);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-muted);
}
.sectionLabelRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sectionLabelRow h3 { margin: 0 0 var(--space-6); }
```

- [ ] **Step 4: Update the Title row's type scale to match the "largest text in the panel" direction**

In `.titleDisplay` and `.titleInput` (added in Task 3), change `font-size: var(--font-size-4)`
to `font-size: var(--font-size-6)` and add `font-weight: var(--font-weight-semibold)` to both
rules.

- [ ] **Step 5: Remove the Pin toggle's bordered-button chrome**

The spec calls this out explicitly: Pinned "loses its bordered-button chrome... to match the
de-carded style." Replace the `.pinButton`/`.pinButtonActive` rules with:

```css
.pinButton {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  padding: var(--space-4) var(--space-5);
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.pinButton svg {
  width: 14px;
  height: 14px;
}
.pinButton:hover {
  color: var(--color-text);
}
.pinButtonActive {
  color: var(--color-warning);
  background: rgba(210, 153, 34, 0.12);
}
.pinButtonActive:hover {
  background: rgba(210, 153, 34, 0.2);
}
```

(The active-state background tint stays — the spec only calls out the *border* as chrome to
remove, not the color signal itself.)

- [ ] **Step 6: Run the tests and confirm nothing broke**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: PASS — this task changes no text content or ARIA roles, only classNames/CSS, so
every prior test (Tasks 1-4) should still pass unmodified.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.module.css
git commit -m "style(frontend): replace InfoPanel card chrome with hairline sections"
```

---

### Task 6: Migrate Raw Buttons onto the `Button` Primitive

Migrates the Pin toggle, Usage refresh button, and Add-Group dialog's Cancel/Create buttons
onto `frontend/src/components/ui/Button.tsx`, closing out `InfoPanel`'s entry in the
Button-migration backlog (`docs/frontend-components.md`).

**Files:**
- Modify: `frontend/src/components/InfoPanel.tsx`
- Modify: `frontend/src/components/InfoPanel.module.css`
- Modify: `docs/frontend-components.md`

**Interfaces:**
- Consumes: `Button` from `./ui/Button` — `ButtonProps extends
  ButtonHTMLAttributes<HTMLButtonElement>` with an optional `variant?: "default" | "primary" |
  "danger"` (default `"default"`). All existing `<button>` attributes (`aria-label`, `onClick`,
  `disabled`, `data-testid`, `className`) pass through unchanged.

- [ ] **Step 1: Confirm the current test suite passes before swapping button elements**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: PASS (baseline — this task swaps `<button>` for `<Button>`, which renders the same
underlying `<button>` element, so no test text/role/label changes are needed)

- [ ] **Step 2: Import `Button` and migrate the Pin toggle**

Add to the top of `InfoPanel.tsx`:

```ts
import { Button } from "./ui/Button";
```

Replace the Pin toggle `<button>`:

```tsx
          <button
            type="button"
            className={`${styles.pinButton} ${pinned ? styles.pinButtonActive : ""}`}
            onClick={() => onPinned(!pinned)}
            aria-label={pinned ? "Unpin session" : "Pin session"}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 2l-1.5 4 5 5 4-1.5v3l-5 1.5-3.5 6.5L13 17l-6 6-1.5-1.5 6-6-3.5-2.5L9.5 8 8 3h3L9.5 7.5l4 4 4-5.5L16 2z" />
            </svg>
          </button>
```

with:

```tsx
          <Button
            type="button"
            className={`${styles.pinButton} ${pinned ? styles.pinButtonActive : ""}`}
            onClick={() => onPinned(!pinned)}
            aria-label={pinned ? "Unpin session" : "Pin session"}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 2l-1.5 4 5 5 4-1.5v3l-5 1.5-3.5 6.5L13 17l-6 6-1.5-1.5 6-6-3.5-2.5L9.5 8 8 3h3L9.5 7.5l4 4 4-5.5L16 2z" />
            </svg>
          </Button>
```

- [ ] **Step 3: Migrate the Usage refresh button**

Replace:

```tsx
              <button
                type="button"
                className={styles.refreshButton}
                aria-label="Refresh usage"
                title="Refresh usage"
                disabled={refreshingUsage}
                onClick={onRefreshUsage}
              >
                <RefreshIcon spinning={refreshingUsage} />
              </button>
```

with:

```tsx
              <Button
                type="button"
                className={styles.refreshButton}
                aria-label="Refresh usage"
                title="Refresh usage"
                disabled={refreshingUsage}
                onClick={onRefreshUsage}
              >
                <RefreshIcon spinning={refreshingUsage} />
              </Button>
```

- [ ] **Step 4: Migrate the Add-Group dialog's Cancel/Create buttons**

Replace:

```tsx
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setAddGroupOpen(false)}>Cancel</button>
              <button type="button" onClick={handleCreateGroup}>Create</button>
            </div>
```

with:

```tsx
            <div className={styles.dialogActions}>
              <Button type="button" onClick={() => setAddGroupOpen(false)}>Cancel</Button>
              <Button type="button" variant="primary" onClick={handleCreateGroup}>Create</Button>
            </div>
```

- [ ] **Step 5: Drop the now-redundant `.dialogActions button` rules**

In `InfoPanel.module.css`, delete the `.dialogActions button` and `.dialogActions
button:last-child` rules (currently lines 165-179) — `Button`'s own component CSS
(`Button.module.css`) now supplies this styling; `.dialogActions` itself stays (it's still the
flex container).

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: PASS

- [ ] **Step 7: Update the Button-migration backlog note**

In `docs/frontend-components.md`, find the note listing which components have/haven't
migrated onto `Button` (per `docs/design/redesign-phases.md`'s backlog: *"`Button` call
sites: `ChatPanel` migrated (Phase 3); `InfoPanel` and `Composer` still use raw `<button>`
elements."*). Update it to remove `InfoPanel` from the not-yet-migrated list, noting only
`Composer` remains (pending its own Phase 4 spec).

- [ ] **Step 8: Typecheck and run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npm run test:web`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.module.css docs/frontend-components.md
git commit -m "refactor(frontend): migrate InfoPanel buttons onto the Button primitive"
```

---

### Task 7: Update `redesign-phases.md`

Records this redesign as a completed phase, consistent with how Phases 1-3 are tracked.

**Files:**
- Modify: `docs/design/redesign-phases.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Get today's date**

Run: `date +%F`
Note the output (e.g. `2026-07-22`) — use it in place of `<DATE>` below.

- [ ] **Step 2: Add a new phase entry**

In `docs/design/redesign-phases.md`, insert a new section after Phase 4's entry (before the
"Backlog: Deferred Findings" section):

```markdown
## Phase 5: Info Panel Redesign — Done (<DATE>)

Restructured `InfoPanel.tsx` from four uniform bordered cards into three typographic
sections (Chat identity → Usage → Session & workspace, merging the old Overview/Session
split), added click-to-edit title, per-window usage meters with a non-color-only ≥80%
warning signal, and migrated its raw `<button>` elements onto the `Button` primitive.
Assumes Phase 4's removal of the Model selector/Auto-approve toggle from this file has
already landed here (done as part of this phase, ahead of Phase 4 itself, to avoid a
compile break — see the spec's Files to Modify note on `ChatPanel.tsx`).

- Spec: `docs/superpowers/specs/2026-07-22-info-panel-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-07-22-info-panel-redesign.md`
```

- [ ] **Step 3: Commit**

```bash
git add docs/design/redesign-phases.md
git commit -m "docs: mark Info Panel Redesign phase done in redesign-phases.md"
```
