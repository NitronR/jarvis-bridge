# Groups Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the group feature by adding backend group registration endpoints, an InfoPanel dropdown with "Add Group" dialog, and a ChatsDrawer Groups tab with collapsible accordion.

**Architecture:** Groups are stored as a `string[]` in the existing `session_metadata.json`. Two new routes (`GET/POST /chat/groups`) expose group CRUD. The frontend fetches groups into `ChatContext`, replaces the InfoPanel text input with a dropdown + dialog, and adds a Groups tab to the ChatsDrawer.

**Tech Stack:** TypeScript, Express + Zod (backend), React + CSS Modules + Vitest + Testing Library (frontend)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/agent/sessionConfigStore.ts` | Modify | Add `groups` to persisted shape, `getGroups()`/`addGroup()` methods |
| `src/agent/sessionConfigStore.test.ts` | Modify | Tests for group CRUD, dedup, sanitization |
| `src/server.ts` | Modify | Add `GET /chat/groups` and `POST /chat/groups` routes + Zod schema |
| `frontend/src/state/ChatContext.tsx` | Modify | Add `groups` to state, fetch in `init()`, expose `setGroups` |
| `frontend/src/components/InfoPanel.tsx` | Modify | Replace text input with dropdown + add-group dialog |
| `frontend/src/components/ChatPanel.tsx` | Modify | Fetch groups, pass to InfoPanel, handle addGroup |
| `frontend/src/components/ChatsDrawer.tsx` | Modify | Add tab bar, Groups tab with collapsible accordion |
| `frontend/src/components/ChatsDrawer.module.css` | Modify | Tab, group section, chevron styles |
| `frontend/src/components/InfoPanel.test.tsx` | Modify | Tests for dropdown + dialog |
| `frontend/src/components/ChatsDrawer.test.tsx` | Modify | Tests for Groups tab |

---

## Task 1: Backend — SessionConfigStore groups methods

**Files:**
- Modify: `src/agent/sessionConfigStore.ts`
- Test: `src/agent/sessionConfigStore.test.ts`

- [ ] **Step 1: Write failing tests for groups**

Add the following tests to the end of `src/agent/sessionConfigStore.test.ts`:

```typescript
test("getGroups returns empty array when no groups exist", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  assert.deepEqual(store.getGroups(), []);
});

test("addGroup adds a group and persists across reload", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  const groups = await store.addGroup("bugfix");
  assert.deepEqual(groups, ["bugfix"]);
  assert.deepEqual(store.getGroups(), ["bugfix"]);

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.deepEqual(reloaded.getGroups(), ["bugfix"]);
});

test("addGroup deduplicates case-insensitively", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.addGroup("Bugfix");
  const groups = await store.addGroup("bugfix");
  assert.deepEqual(groups, ["Bugfix"]);
  assert.equal(store.getGroups().length, 1);
});

test("addGroup rejects empty and whitespace-only names", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await assert.rejects(() => store.addGroup(""), /non-empty/);
  await assert.rejects(() => store.addGroup("   "), /non-empty/);
  assert.deepEqual(store.getGroups(), []);
});

test("addGroup maintains insertion order", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.addGroup("feature");
  await store.addGroup("bugfix");
  await store.addGroup("research");
  assert.deepEqual(store.getGroups(), ["feature", "bugfix", "research"]);
});

test("sanitizes malformed groups on load", async () => {
  const p = await tmpPath();
  await fs.writeFile(
    p,
    JSON.stringify({ groups: ["ok", 42, null, "also-ok"] }),
    "utf8",
  );
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  assert.deepEqual(store.getGroups(), ["ok", "also-ok"]);
});

test("ignores non-array groups on load", async () => {
  const p = await tmpPath();
  await fs.writeFile(
    p,
    JSON.stringify({ groups: "not-an-array" }),
    "utf8",
  );
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  assert.deepEqual(store.getGroups(), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/sessionConfigStore.test.ts`
Expected: FAIL — `store.getGroups is not a function` (method doesn't exist yet)

- [ ] **Step 3: Implement groups in SessionConfigStore**

In `src/agent/sessionConfigStore.ts`:

1. Add `groups?: unknown` to `PersistedFileShape` (line ~49, alongside `usage`):

```typescript
interface PersistedFileShape {
  autoApprove?: {
    default?: boolean;
    overrides?: Record<string, boolean>;
  };
  metadata?: Record<string, {
    customTitle?: unknown;
    pinned?: unknown;
    group?: unknown;
  }>;
  cwds?: Record<string, string>;
  usage?: Record<string, unknown>;
  groups?: unknown;
}
```

2. Add `getGroups` and `addGroup` to the `SessionConfigStore` interface (after `setLastUsage`, ~line 35):

```typescript
export interface SessionConfigStore {
  // ... existing methods ...
  getLastUsage(sessionId: string): UsageTotals | undefined;
  setLastUsage(sessionId: string, usage: UsageTotals): Promise<void>;
  getGroups(): string[];
  addGroup(name: string): Promise<string[]>;
}
```

3. Add a `sanitizeGroups` helper (after `sanitizeMetadata`, ~line 104):

```typescript
function sanitizeGroups(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((g): g is string => typeof g === "string" && g.trim().length > 0);
}
```

4. In `createSessionConfigStore`, load groups from persistence (after loading `lastUsage`, ~line 139):

```typescript
const groups: string[] = sanitizeGroups(persisted.groups);
```

5. Add `groups` to the `persist` function's data object (~line 149):

```typescript
async function persist(): Promise<void> {
  const data: PersistedFileShape = {
    autoApprove: {
      default: autoApproveDefault,
      overrides: Object.fromEntries(autoApproveOverrides),
    },
    metadata: Object.fromEntries(metadata),
    cwds: Object.fromEntries(sessionCwds),
    usage: Object.fromEntries(lastUsage),
    groups,
  };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}
```

6. Add the `getGroups` and `addGroup` methods to the returned object (after `setLastUsage`, ~line 212):

```typescript
    getGroups(): string[] {
      return [...groups];
    },
    async addGroup(name: string): Promise<string[]> {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("group name must be non-empty");
      const existing = groups.find((g) => g.toLowerCase() === trimmed.toLowerCase());
      if (!existing) {
        groups.push(trimmed);
        await persist();
      }
      return [...groups];
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/sessionConfigStore.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full backend test suite**

Run: `npm test`
Expected: All tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/agent/sessionConfigStore.ts src/agent/sessionConfigStore.test.ts
git commit -m "feat(backend): add getGroups/addGroup to SessionConfigStore"
```

---

## Task 2: Backend — Groups API routes

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add Zod schema for POST /chat/groups**

Add near the other Zod schemas (after `SetDefaultBackendBodySchema`, ~line 760):

```typescript
const CreateGroupBodySchema = z.object({ name: z.string().min(1).max(100) });
```

- [ ] **Step 2: Add GET /chat/groups route**

Add after the `DELETE /chat/sessions/:sessionId` route (~line 501) and before the `// ── Status` section:

```typescript
  // ── Groups ──────────────────────────────────────────────────────────
  app.get("/chat/groups", smallJson, (_req, res) => {
    const groups = opts.sessionConfig?.getGroups() ?? [];
    res.json({ groups });
  });

  app.post("/chat/groups", smallJson, asyncRoute(async (req, res) => {
    const body = CreateGroupBodySchema.parse(req.body ?? {});
    if (!opts.sessionConfig) {
      res.status(500).json({ error: "session config not available" });
      return;
    }
    const groups = await opts.sessionConfig.addGroup(body.name);
    res.json({ ok: true, groups });
  }));
```

- [ ] **Step 3: Verify server compiles**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(backend): add GET/POST /chat/groups routes"
```

---

## Task 3: Frontend — ChatContext groups state

**Files:**
- Modify: `frontend/src/state/ChatContext.tsx`

- [ ] **Step 1: Add groups to ChatState**

In `frontend/src/state/ChatContext.tsx`, add `groups: string[]` to the `ChatState` interface (after `group`, ~line 25):

```typescript
export interface ChatState {
  // ... existing fields ...
  group: string;
  groups: string[];
  resumed: boolean;
  // ...
}
```

Add `groups: []` to the `INITIAL` constant (after `group: ""`, ~line 47):

```typescript
const INITIAL: ChatState = {
  // ... existing fields ...
  group: "",
  groups: [],
  resumed: false,
  // ...
};
```

- [ ] **Step 2: Add setGroups to ChatContextApi**

Add to `ChatContextApi` interface (after `setGroup`, ~line 62):

```typescript
export interface ChatContextApi {
  // ... existing methods ...
  setGroup: (g: string) => void;
  setGroups: (g: string[]) => void;
  // ...
}
```

- [ ] **Step 3: Implement setGroups callback**

Add the `setGroups` callback in `ChatProvider` (after the `setGroup` callback, ~line 220):

```typescript
  const setGroups = useCallback((g: string[]) => setState((s) => ({ ...s, groups: g })), []);
```

- [ ] **Step 4: Add setGroups to the api useMemo**

Add `setGroups` to the destructured array in the `useMemo` for `api` (~line 263-265):

```typescript
  const api = useMemo<ChatContextApi>(
    () => ({ state, init, setBusy, setUnread, setTitle, setPinned, setGroup, setGroups, setSlashCommands, setModels, setAutoApprove, setSession, reset, getTurnCount, pruneTurnCounts }),
    [state, init, setBusy, setUnread, setTitle, setPinned, setGroup, setGroups, setSlashCommands, setModels, setAutoApprove, setSession, reset, getTurnCount, pruneTurnCounts],
  );
```

- [ ] **Step 5: Fetch groups in init()**

In the `init` callback, after the `setState` that sets session data (~line 186, before `setSessionIdInUrl`), add:

```typescript
      // Fetch available groups
      const groupsRes = await fetchJSON<{ groups: string[] }>("/chat/groups");
      if (groupsRes.ok && Array.isArray(groupsRes.data?.groups)) {
        setState((s) => ({ ...s, groups: groupsRes.data!.groups }));
      }
```

- [ ] **Step 6: Verify frontend compiles**

Run: `npm run build:web`
Expected: Build succeeds with no errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/state/ChatContext.tsx
git commit -m "feat(frontend): add groups state to ChatContext"
```

---

## Task 4: Frontend — InfoPanel dropdown + add-group dialog

**Files:**
- Modify: `frontend/src/components/InfoPanel.tsx`
- Modify: `frontend/src/components/InfoPanel.test.tsx`

- [ ] **Step 1: Add failing tests for dropdown + dialog**

Add the following tests to `frontend/src/components/InfoPanel.test.tsx`:

First, update `baseProps` to include the new props:

```typescript
const baseProps = {
  state: baseState, title: "My chat", group: "", groups: [], pinned: false,
  onRename: vi.fn(), onGroup: vi.fn(), onAddGroup: vi.fn(), onPinned: vi.fn(),
  onModelChange: vi.fn(), onAutoApproveToggle: vi.fn(),
};
```

Then add the test cases:

```typescript
  it("renders a group dropdown instead of a text input", () => {
    render(<InfoPanel {...baseProps} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
  });

  it("populates the dropdown with provided groups", () => {
    render(<InfoPanel {...baseProps} groups={["bugfix", "feature"]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("bugfix");
    expect(options).toContain("feature");
  });

  it("includes a None option and Add Group option", () => {
    render(<InfoPanel {...baseProps} groups={["bugfix"]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContainEqual("None");
    expect(options).toContainEqual("+ Add Group…");
  });

  it("selects the current group value", () => {
    render(<InfoPanel {...baseProps} group="bugfix" groups={["bugfix", "feature"]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    expect(select.value).toBe("bugfix");
  });

  it("calls onGroup when a group is selected", () => {
    const onGroup = vi.fn();
    render(<InfoPanel {...baseProps} groups={["bugfix"]} onGroup={onGroup} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "bugfix" } });
    expect(onGroup).toHaveBeenCalledWith("bugfix");
  });

  it("calls onGroup with empty string when None is selected", () => {
    const onGroup = vi.fn();
    render(<InfoPanel {...baseProps} group="bugfix" groups={["bugfix"]} onGroup={onGroup} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    expect(onGroup).toHaveBeenCalledWith("");
  });

  it("opens add-group dialog when Add Group is selected", () => {
    render(<InfoPanel {...baseProps} groups={["bugfix"]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__add_group__" } });
    expect(screen.getByText("Add Group")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/group name/i)).toBeInTheDocument();
  });

  it("calls onAddGroup and onGroup when a new group is created", async () => {
    const onAddGroup = vi.fn().mockResolvedValue(undefined);
    const onGroup = vi.fn();
    render(<InfoPanel {...baseProps} groups={[]} onAddGroup={onAddGroup} onGroup={onGroup} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__add_group__" } });
    fireEvent.change(screen.getByPlaceholderText(/group name/i), { target: { value: "new-group" } });
    fireEvent.click(screen.getByText("Create"));
    await vi.waitFor(() => {
      expect(onAddGroup).toHaveBeenCalledWith("new-group");
      expect(onGroup).toHaveBeenCalledWith("new-group");
    });
  });

  it("closes the dialog on Cancel", () => {
    render(<InfoPanel {...baseProps} groups={[]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__add_group__" } });
    expect(screen.getByText("Add Group")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Add Group")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: FAIL — tests expect a `<select>` but find an `<input>`

- [ ] **Step 3: Implement InfoPanel dropdown + dialog**

Replace the group `<input>` in `InfoPanel.tsx` (lines 109-112) with the following. Also add `groups` and `onAddGroup` to the props interface and add dialog state.

Updated props interface:

```typescript
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
  onModelChange: (modelId: string) => void;
  onAutoApproveToggle: () => void;
  onRefreshUsage?: () => void;
}
```

Add dialog state and handler inside the component:

```typescript
const [addGroupOpen, setAddGroupOpen] = useState(false);
const [newGroupName, setNewGroupName] = useState("");
```

Add the `handleGroupChange` function:

```typescript
const handleGroupChange = (value: string) => {
  if (value === "__add_group__") {
    setAddGroupOpen(true);
    setNewGroupName("");
    return;
  }
  onGroup(value);
};
```

Add the `handleCreateGroup` function:

```typescript
const handleCreateGroup = async () => {
  const name = newGroupName.trim();
  if (!name) return;
  await onAddGroup(name);
  onGroup(name);
  setAddGroupOpen(false);
  setNewGroupName("");
};
```

Replace the group row (lines 109-112):

```typescript
        <div className={styles.row}>
          <span className={styles.key}>Group</span>
          <select
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
```

Add the dialog JSX at the end of the component (before the closing `</aside>`):

```typescript
      {addGroupOpen && (
        <div className={styles.dialogBackdrop} onClick={() => setAddGroupOpen(false)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h4>Add Group</h4>
            <input
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }}
              autoFocus
            />
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setAddGroupOpen(false)}>Cancel</button>
              <button type="button" onClick={handleCreateGroup}>Create</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Add dialog CSS to InfoPanel.module.css**

Read `frontend/src/components/InfoPanel.module.css` first, then add these classes:

```css
.dialogBackdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 20px;
  min-width: 280px;
  box-shadow: var(--shadow-md);
}

.dialog h4 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--color-text);
}

.dialog input {
  width: 100%;
  background: var(--color-surface-2);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: 13px;
  margin-bottom: 12px;
}

.dialog input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.dialogActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialogActions button {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}

.dialogActions button:last-child {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}
```

- [ ] **Step 5: Run InfoPanel tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/InfoPanel.test.tsx`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.module.css frontend/src/components/InfoPanel.test.tsx
git commit -m "feat(frontend): replace group text input with dropdown + add-group dialog"
```

---

## Task 5: Frontend — Wire InfoPanel groups in ChatPanel

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`

- [ ] **Step 1: Add groups fetch and onAddGroup handler**

In `ChatPanel.tsx`, add a `useEffect` to fetch groups when the session changes. Add near the other `useEffect` hooks:

```typescript
  // Fetch available groups on session init
  useEffect(() => {
    if (!ctx.state.sessionId) return;
    void fetchJSON<{ groups: string[] }>("/chat/groups").then((res) => {
      if (res.ok && Array.isArray(res.data?.groups)) {
        ctx.setGroups(res.data!.groups);
      }
    });
  }, [ctx.state.sessionId]);
```

Add the `onAddGroup` callback (near `onGroupChange`, ~line 268):

```typescript
  const onAddGroup = useCallback(
    async (name: string) => {
      const res = await fetchJSON<{ ok: boolean; groups: string[] }>("/chat/groups", {
        method: "POST",
        body: { name },
      });
      if (res.ok && Array.isArray(res.data?.groups)) {
        ctx.setGroups(res.data!.groups);
      }
    },
    [ctx],
  );
```

- [ ] **Step 2: Pass new props to InfoPanel**

Find the `<InfoPanel>` rendering in `ChatPanel.tsx` and add the new props. The InfoPanel is rendered with props like `group={ctx.state.group}`. Add:

```tsx
<InfoPanel
  // ... existing props ...
  groups={ctx.state.groups}
  onAddGroup={onAddGroup}
/>
```

- [ ] **Step 3: Verify compilation**

Run: `npm run build:web`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx
git commit -m "feat(frontend): wire groups state into ChatPanel and InfoPanel"
```

---

## Task 6: Frontend — ChatsDrawer Groups tab

**Files:**
- Modify: `frontend/src/components/ChatsDrawer.tsx`
- Modify: `frontend/src/components/ChatsDrawer.module.css`
- Modify: `frontend/src/components/ChatsDrawer.test.tsx`

- [ ] **Step 1: Add failing tests for Groups tab**

Add the following tests to `frontend/src/components/ChatsDrawer.test.tsx`:

```typescript
  describe("Groups tab", () => {
    const TAB_KEY = "jarvis.lastChatsTab";
    const renderWithGroups = (props: { sessions?: any[]; groups?: string[] } = {}) => {
      const sessions = props.sessions ?? [
        { sessionId: "s1", title: "Alpha", group: "bugfix" },
        { sessionId: "s2", title: "Beta", group: "bugfix" },
        { sessionId: "s3", title: "Gamma", group: "feature" },
        { sessionId: "s4", title: "Delta" },
      ];
      return render(
        <ChatsDrawer
          open={true}
          sessions={sessions}
          groups={props.groups ?? ["bugfix", "feature", "research"]}
          onClose={vi.fn()}
          onSwitch={vi.fn()}
        />,
      );
    };

    it("renders Chats and Groups tabs", () => {
      renderWithGroups();
      expect(screen.getByRole("button", { name: "Chats" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Groups" })).toBeInTheDocument();
    });

    it("defaults to Chats tab showing flat list", () => {
      renderWithGroups();
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    it("switches to Groups tab showing grouped sessions", () => {
      renderWithGroups();
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      expect(screen.getByText("bugfix")).toBeInTheDocument();
      expect(screen.getByText("feature")).toBeInTheDocument();
      expect(screen.getByText("research")).toBeInTheDocument();
    });

    it("shows Ungrouped section for sessions without a group", () => {
      renderWithGroups();
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      expect(screen.getByText("Ungrouped")).toBeInTheDocument();
    });

    it("expands a group to reveal its sessions on click", () => {
      renderWithGroups();
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      // Initially sessions under groups should not be visible
      expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
      // Click bugfix group header
      fireEvent.click(screen.getByText("bugfix"));
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    it("shows session count badge on group headers", () => {
      renderWithGroups();
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      expect(screen.getByText("2")).toBeInTheDocument(); // 2 sessions in bugfix
    });

    it("calls onSwitch when a session card is clicked in Groups tab", () => {
      const onSwitch = vi.fn();
      render(
        <ChatsDrawer
          open={true}
          sessions={[
            { sessionId: "s1", title: "Alpha", group: "bugfix" },
          ]}
          groups={["bugfix"]}
          onClose={vi.fn()}
          onSwitch={onSwitch}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      fireEvent.click(screen.getByText("bugfix"));
      fireEvent.click(screen.getByText("Alpha"));
      expect(onSwitch).toHaveBeenCalledWith("s1");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ChatsDrawer.test.tsx`
Expected: FAIL — tabs don't exist, `groups` prop not recognized

- [ ] **Step 3: Add groups prop and tab state to ChatsDrawer**

Update `ChatsDrawerProps` to accept `groups`:

```typescript
export interface ChatsDrawerProps {
  open: boolean;
  sessions: SessionSummary[];
  groups?: string[];
  recentWorkspaces?: string[];
  onClose: () => void;
  onSwitch: (sessionId: string) => void;
  onOpenInNewTab?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  canDelete?: boolean;
  getTurnCount?: (sessionId: string) => number | undefined;
}
```

Add tab state and localStorage persistence (near the other state declarations, ~line 100):

```typescript
const TAB_STORAGE_KEY = "jarvis.lastChatsTab";

function safeGetStoredTab(): string {
  try {
    return window.localStorage?.getItem(TAB_STORAGE_KEY) ?? "chats";
  } catch {
    return "chats";
  }
}

function safeSetStoredTab(value: string): void {
  try {
    window.localStorage?.setItem(TAB_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}
```

Add inside the component:

```typescript
const [activeTab, setActiveTab] = useState<string>(() => safeGetStoredTab());
const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

const handleTabChange = (tab: string) => {
  setActiveTab(tab);
  safeSetStoredTab(tab);
};

const toggleGroup = (group: string) => {
  setExpandedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    return next;
  });
};
```

- [ ] **Step 4: Add Groups tab content**

After the `</ul>` closing tag (line 300) and before the closing `</aside>` (line 302), add the Groups tab content:

```tsx
        {activeTab === "groups" && (
          <div className={styles.groupsList}>
            {(() => {
              const groupMap = new Map<string, SessionSummary[]>();
              for (const g of groups ?? []) groupMap.set(g, []);
              const ungrouped: SessionSummary[] = [];
              for (const s of filteredSessions) {
                if (s.group && groupMap.has(s.group)) {
                  groupMap.get(s.group)!.push(s);
                } else {
                  ungrouped.push(s);
                }
              }
              const sections: Array<{ key: string; label: string; sessions: SessionSummary[] }> = [];
              for (const [g, ss] of groupMap) {
                sections.push({ key: g, label: g, sessions: ss });
              }
              if (ungrouped.length > 0) {
                sections.push({ key: "__ungrouped__", label: "Ungrouped", sessions: ungrouped });
              }
              if (sections.length === 0) {
                return <div className={styles.empty}>No groups yet.</div>;
              }
              return sections.map((sec) => (
                <div key={sec.key} className={styles.groupSection}>
                  <button
                    type="button"
                    className={`${styles.groupHeader} ${expandedGroups.has(sec.key) ? styles.groupHeaderExpanded : ""}`}
                    onClick={() => toggleGroup(sec.key)}
                  >
                    <span className={`${styles.chevron} ${expandedGroups.has(sec.key) ? styles.chevronOpen : ""}`}>▶</span>
                    <span className={styles.groupName}>{sec.label}</span>
                    <span className={styles.groupCount}>{sec.sessions.length}</span>
                  </button>
                  {expandedGroups.has(sec.key) && (
                    <div className={styles.groupSessions}>
                      {sec.sessions.length === 0 ? (
                        <div className={styles.empty}>No sessions</div>
                      ) : (
                        sec.sessions.map((s) => {
                          const title = s.customTitle || s.title || s.sessionId.slice(0, 12);
                          return (
                            <div
                              key={s.sessionId}
                              className={`${styles.card} ${s.active ? styles.cardActive : ""}`}
                              onClick={() => onSwitch(s.sessionId)}
                            >
                              <div className={styles.cardTop}>
                                <div className={styles.cardTitle}>{title}</div>
                                {s.updatedAt && (
                                  <div className={styles.cardTime}>{formatRelative(s.updatedAt)}</div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              ));
            })()}
          </div>
        )}
```

- [ ] **Step 5: Add tab bar to the header area**

Replace the current header section (lines 188-219) to include the tab bar. The header now has the title, tabs, filters, and close button:

```tsx
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <h2 className={styles.headerTitle}>Chats</h2>
            <button type="button" className={styles.closeButton} onClick={onClose}>
              Close
            </button>
          </div>
          <div className={styles.tabBar}>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === "chats" ? styles.tabActive : ""}`}
              onClick={() => handleTabChange("chats")}
            >
              Chats
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === "groups" ? styles.tabActive : ""}`}
              onClick={() => handleTabChange("groups")}
            >
              Groups
            </button>
          </div>
          {activeTab === "chats" && (
            <div className={styles.filterRow}>
              {workspaces.length > 0 && (
                <select
                  className={styles.filterSelect}
                  aria-label="Workspace"
                  value={filter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                >
                  <option value={FILTER_ALL}>All workspaces</option>
                  {workspaces.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              )}
              {backends.length > 1 && (
                <select
                  className={styles.filterSelect}
                  aria-label="Backend"
                  value={backendFilter}
                  onChange={(e) => handleBackendFilterChange(e.target.value)}
                >
                  <option value={FILTER_ALL}>All backends</option>
                  {backends.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </header>
```

- [ ] **Step 6: Add CSS for tabs and group sections**

Add to `frontend/src/components/ChatsDrawer.module.css`:

```css
.headerTop {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.filterRow {
  display: flex;
  gap: 6px;
  width: 100%;
}

.tabBar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-border);
  margin-top: 8px;
}

.tab {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text-muted);
  padding: 6px 0;
  font-size: 12px;
  cursor: pointer;
  text-align: center;
}

.tab:hover {
  color: var(--color-text);
}

.tabActive {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
  font-weight: 600;
}

.groupsList {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  flex: 1;
}

.groupSection {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.groupHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: var(--color-surface-2);
  border: none;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  color: var(--color-text);
  font-size: 13px;
}

.groupHeader:hover {
  background: var(--color-surface-3);
}

.groupHeaderExpanded {
  border-bottom: 1px solid var(--color-border);
}

.chevron {
  font-size: 10px;
  transition: transform 150ms ease;
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.chevronOpen {
  transform: rotate(90deg);
}

.groupName {
  flex: 1;
  font-weight: 600;
}

.groupCount {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--color-surface-3);
  color: var(--color-text-muted);
}

.groupSessions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}
```

Also update the existing `.header` style to use flex-direction column for the new layout:

```css
.header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
```

- [ ] **Step 7: Run ChatsDrawer tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ChatsDrawer.test.tsx`
Expected: All tests PASS

- [ ] **Step 8: Run full frontend test suite**

Run: `cd frontend && npm run test:web`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/ChatsDrawer.tsx frontend/src/components/ChatsDrawer.module.css frontend/src/components/ChatsDrawer.test.tsx
git commit -m "feat(frontend): add Groups tab to ChatsDrawer with collapsible accordion"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full backend typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 2: Run full backend tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Run full frontend build**

Run: `npm run build:web`
Expected: Build succeeds

- [ ] **Step 4: Run full frontend tests**

Run: `cd frontend && npm run test:web`
Expected: All tests PASS

- [ ] **Step 5: Final commit (if any cleanup needed)**

No commit needed if all prior commits are clean.
