# Header/Toolbar Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup ChatPanel's 9 flat header buttons into primary/secondary groups with icons, migrate onto the Button primitive, and replace "AA✓" with a self-explanatory "Auto-approve" toggle.

**Architecture:** Two files change: `ChatPanel.tsx` (button markup + grouping + icons) and `ChatPanel.module.css` (new divider rule, simplified button rule). No new tokens, no new components. The Button primitive is consumed as-is.

**Tech Stack:** React, TypeScript, CSS Modules, existing Button primitive from `frontend/src/components/ui/Button.tsx`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/components/ChatPanel.module.css` | Modify | Add `.divider` rule, simplify `.header button` rule |
| `frontend/src/components/ChatPanel.tsx` | Modify | Migrate buttons to `Button` primitive, regroup with divider, add icons, rename auto-approve |
| `frontend/src/components/ChatPanel.test.tsx` | Modify | Add header structure + auto-approve toggle test |

---

### Task 1: Add divider CSS rule

**Files:**
- Modify: `frontend/src/components/ChatPanel.module.css`

- [ ] **Step 1: Add the `.divider` rule to ChatPanel.module.css**

Add after the `.header button` rule (line 23):

```css
.divider {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 var(--space-2);
  flex-shrink: 0;
}
```

- [ ] **Step 2: Verify CSS compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors from CSS module changes)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChatPanel.module.css
git commit -m "feat(frontend): add header divider CSS rule for toolbar regrouping"
```

---

### Task 2: Migrate header buttons to Button primitive with grouping, icons, and auto-approve rename

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`

- [ ] **Step 1: Add Button import to ChatPanel.tsx**

Add to the imports at the top of `ChatPanel.tsx` (after line 14, the `styles` import):

```tsx
import { Button } from "./ui/Button";
```

- [ ] **Step 2: Replace the header button markup (lines 409–438)**

Replace the entire `<div className={styles.header}>...</div>` block with the regrouped version. The old code (lines 409–438):

```tsx
          <div className={styles.header}>
            <h1>{ctx.state.title || "New chat"}</h1>
            <button onClick={() => setInfoHidden((v) => !v)}>Info</button>
            <button
              onClick={() => setFollowChat((v) => !v)}
              className={followChat ? "primary" : ""}
              title={followChat ? "Following chat — click to stop auto-scrolling" : "Not following — click to auto-scroll to latest"}
            >
              Follow
            </button>
            <button onClick={openPastChats}>Chats</button>
            <button onClick={onNewChat}>+ New</button>
            <button
              onClick={onNewChatInWorkspace}
              disabled={!ctx.state.capabilities?.customWorkingDirectory || pickingFolder}
            >
              + New in...
            </button>
            <button onClick={onForkCurrent} disabled={!ctx.state.capabilities?.canFork || chat.busy}>Fork</button>
            <button
              onClick={() => setSteerEnabled((v) => !v)}
              disabled={!ctx.state.capabilities?.steer}
              className={steerEnabled ? "primary" : ""}
            >
              Steer
            </button>
            <button onClick={() => void chat.setAutoApprove(!ctx.state.autoApprove.effective)} disabled={!ctx.state.capabilities?.toolApprovals}>
              {ctx.state.autoApprove.effective ? "AA✓" : "AA"}
            </button>
          </div>
```

Becomes:

```tsx
          <div className={styles.header}>
            <h1>{ctx.state.title || "New chat"}</h1>
            {/* Primary group */}
            <Button variant="primary" onClick={onNewChat}>＋ New</Button>
            <Button
              variant={followChat ? "primary" : "default"}
              onClick={() => setFollowChat((v) => !v)}
              title={followChat ? "Following chat — click to stop auto-scrolling" : "Not following — click to auto-scroll to latest"}
            >
              ↓ Follow
            </Button>
            <Button onClick={openPastChats}>☰ Chats</Button>
            {/* Divider */}
            <span className={styles.divider} />
            {/* Secondary group */}
            <Button onClick={() => setInfoHidden((v) => !v)}>ℹ Info</Button>
            <Button
              onClick={onNewChatInWorkspace}
              disabled={!ctx.state.capabilities?.customWorkingDirectory || pickingFolder}
            >
              ＋ New in...
            </Button>
            <Button onClick={onForkCurrent} disabled={!ctx.state.capabilities?.canFork || chat.busy}>⑂ Fork</Button>
            <Button
              variant={steerEnabled ? "primary" : "default"}
              onClick={() => setSteerEnabled((v) => !v)}
              disabled={!ctx.state.capabilities?.steer}
            >
              ↗ Steer
            </Button>
            <Button
              variant={ctx.state.autoApprove.effective ? "primary" : "default"}
              onClick={() => void chat.setAutoApprove(!ctx.state.autoApprove.effective)}
              disabled={!ctx.state.capabilities?.toolApprovals}
            >
              {ctx.state.autoApprove.effective ? "✓ Auto-approve" : "Auto-approve"}
            </Button>
          </div>
```

- [ ] **Step 3: Run existing tests to verify nothing breaks**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx`
Expected: PASS — all existing assertions still work because:
- `screen.getByText("Info")` still finds the Info button (text content unchanged)
- `screen.getByText("Chats")` still finds the Chats button (text content unchanged)
- Button variants are CSS-only, invisible to text queries

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx
git commit -m "feat(frontend): migrate ChatPanel header to Button primitive with primary/secondary grouping"
```

---

### Task 3: Add header structure and auto-approve toggle test

**Files:**
- Modify: `frontend/src/components/ChatPanel.test.tsx`

- [ ] **Step 1: Add the new header test**

Add a new `describe` block inside the existing `describe("<ChatPanel>", ...)` (after the "deleting the active session" block, around line 166):

```tsx
  describe("header toolbar", () => {
    it("renders 9 buttons with a divider separating primary and secondary groups", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
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

      // Secondary group: Info, New in..., Fork, Steer, Auto-approve
      expect(screen.getByText("ℹ Info")).toBeInTheDocument();
      expect(screen.getByText("＋ New in...")).toBeInTheDocument();
      expect(screen.getByText("⑂ Fork")).toBeInTheDocument();
      expect(screen.getByText("↗ Steer")).toBeInTheDocument();
      expect(screen.getByText("Auto-approve")).toBeInTheDocument();
    });

    it("toggles auto-approve button variant on click", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByText("New chat")).toBeInTheDocument());

      const aaButton = screen.getByText("Auto-approve");
      // Initially off — should not have primary variant class
      expect(aaButton.className).not.toMatch(/primary/);

      fireEvent.click(aaButton);
      // After click — should show "✓ Auto-approve" and have primary variant
      await waitFor(() => expect(screen.getByText("✓ Auto-approve")).toBeInTheDocument());
      const toggledButton = screen.getByText("✓ Auto-approve");
      expect(toggledButton.className).toMatch(/primary/);
    });
  });
```

- [ ] **Step 2: Run the new test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx`
Expected: PASS — all 5 existing tests + 2 new tests pass

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npm run test:web`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatPanel.test.tsx
git commit -m "test(frontend): add header toolbar structure and auto-approve toggle tests"
```
