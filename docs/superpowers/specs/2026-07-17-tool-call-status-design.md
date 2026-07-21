# Tool Call Status Indicators

## Overview

Add visual status indicators to tool calls in the chat timeline, showing three states: in progress, success, and fail.

## Current State

Tool calls render as `<details>` elements in `Timeline.tsx:163-176`. Currently:
- **Fail state**: Red border/text via `.toolError` class
- **Success state**: Green "ok" text when `b.result.ok` is true
- **In progress**: No visual distinction until result arrives

The `Bubble` type tracks: `{ kind: "tool"; toolName: string; argsText: string; result?: { ok: boolean; text: string } }`

## Design

### Visual Behavior

| State | Border | Spinner | Text Label |
|-------|--------|---------|------------|
| In progress | Blue (`--color-accent`) | Rotating CSS spinner on right of tool name | None |
| Success | Green (`--color-success`) | None | "ok" (green) |
| Fail | Red (`--color-danger`) | None | "error" (red) |

### Implementation Approach

**Derive status from existing `result` field** — no type changes needed:
- No `result` → in-progress
- `result.ok === true` → success
- `result.ok === false` → fail

### Files to Modify

1. **`frontend/src/components/Timeline.module.css`** — Add CSS classes
2. **`frontend/src/components/Timeline.tsx`** — Update `renderBubble` tool case

### No Changes Needed

- `Bubble` type — status derived from existing field
- `Message.tsx` — no changes
- API types — no changes

---

## Detailed Changes

### CSS (`Timeline.module.css`)

Add the following classes:

```css
/* In progress state - blue border */
.toolInProgress {
  border-color: var(--color-accent);
}

/* Success state - green border */
.toolSuccess {
  border-color: var(--color-success);
}

/* Spinner - positioned right of tool name in summary */
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

### Component (`Timeline.tsx`)

Update the `tool` case in `renderBubble`:

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

## Edge Cases

1. **Tool calls with no result yet**: Shows blue border + spinner
2. **Tool calls that error**: Spinner disappears, border turns red
3. **Tool calls that succeed**: Spinner disappears, border turns green
4. **Orphan tool returns**: Already handled separately, no changes needed

## Testing

- Verify spinner animates correctly
- Verify spinner disappears on completion
- Verify border colors change correctly for each state
- Verify existing "ok"/"error" text labels still work
- Run frontend tests: `cd frontend && npm run test:web`
