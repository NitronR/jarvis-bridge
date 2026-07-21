# Tool Call Status Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual status indicators to tool calls in the chat timeline showing in-progress (blue border + spinner), success (green border), and fail (red border) states.

**Architecture:** Derive status from existing `result` field in the `Bubble` type — no schema changes needed. Add CSS classes for new states and update `renderBubble` to apply them conditionally.

**Tech Stack:** React, CSS Modules, TypeScript

---

## File Structure

- **Modify:** `frontend/src/components/Timeline.module.css` — Add `.toolInProgress`, `.toolSuccess`, `.spinner` classes
- **Modify:** `frontend/src/components/Timeline.tsx:163-176` — Update tool case in `renderBubble`

---

### Task 1: Add CSS Classes

**Files:**
- Modify: `frontend/src/components/Timeline.module.css`

- [ ] **Step 1: Add in-progress state class**

Add after `.toolError` class (line 36):

```css
.toolInProgress {
  border-color: var(--color-accent);
}
```

- [ ] **Step 2: Add success state class**

Add after `.toolInProgress` class:

```css
.toolSuccess {
  border-color: var(--color-success);
}
```

- [ ] **Step 3: Add spinner styles**

Add after `.toolSuccess` class:

```css
.spinner {
  display: inline-block;
  margin-left: 8px;
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  vertical-align: middle;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: Verify CSS compiles**

Run: `cd frontend && npm run build:web`
Expected: Build succeeds with no CSS errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Timeline.module.css
git commit -m "feat(frontend): add CSS classes for tool call status indicators"
```

---

### Task 2: Update Component Logic

**Files:**
- Modify: `frontend/src/components/Timeline.tsx:163-176`

- [ ] **Step 1: Replace tool case in renderBubble**

Replace the existing `case "tool":` block (lines 163-176) with:

```tsx
case "tool": {
  // Derive status from result
  const status = !b.result ? "in-progress" : b.result.ok ? "success" : "fail";
  
  // Build className based on status
  const toolClass = status === "in-progress" 
    ? `${styles.tool} ${styles.toolInProgress}`
    : status === "success"
    ? `${styles.tool} ${styles.toolSuccess}`
    : `${styles.tool} ${styles.toolError}`;
  
  return (
    <details key={key} className={toolClass}>
      <summary>
        {b.toolName}
        {status === "in-progress" && <span className={styles.spinner} />}
      </summary>
      {b.argsText && <pre className={styles.toolArgs}>{b.argsText}</pre>}
      {b.result && (
        <div className={styles.toolResult}>
          <span className={b.result.ok ? styles.ok : styles.err}>
            {b.result.ok ? "ok" : "error"}
          </span>{" "}
          {b.result.text}
        </div>
      )}
    </details>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npm run typecheck`
Expected: No type errors

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npm run test:web`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Timeline.tsx
git commit -m "feat(frontend): add status-based styling to tool call components"
```

---

### Task 3: Visual Verification

**Files:**
- None (manual testing)

- [ ] **Step 1: Start dev server**

Run: `cd frontend && npm run dev`

- [ ] **Step 2: Test in-progress state**

Send a message that triggers a tool call. Verify:
- Blue border appears while tool is executing
- Spinner animates to the right of tool name
- Spinner disappears when tool completes

- [ ] **Step 3: Test success state**

After tool completes successfully, verify:
- Border changes from blue to green
- "ok" text appears in green
- No spinner visible

- [ ] **Step 4: Test fail state**

Trigger a tool error (if possible), verify:
- Border changes to red
- "error" text appears in red
- No spinner visible

- [ ] **Step 5: Stop dev server**

Run: `Ctrl+C` in dev server terminal
