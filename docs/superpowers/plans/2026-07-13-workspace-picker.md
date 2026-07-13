# Open New Chat in a Specific Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user start a new chat rooted at an arbitrary directory,
chosen via macOS's native folder dialog, by finishing the existing
`POST /chat/pick-folder` stub and wiring a new "+ New in..." button through
to the already-working `GET /chat/init?cwd=` endpoint.

**Architecture:** Backend shells out to `osascript -e 'choose folder'`
(macOS only) behind an injectable `pickFolder` function so tests never spawn
a real dialog. Frontend adds one button that calls `/chat/pick-folder`, then
feeds the returned path into a new `useChat.startNewChatInWorkspace(cwd)`
which reuses the existing `ChatContext.init(sessionId, cwd)` path. No new
directory-listing endpoint, no modal component.

**Tech Stack:** TypeScript (Node/Express backend, `zod` validation), React
frontend, `node:test` + `assert` for backend tests, Vitest + Testing Library
for frontend tests.

## Global Constraints

- Backend compiles to CommonJS, `tsc --noEmit --strict`. Frontend is ESM
  (Vite), also `--strict`.
- Backend tests: `node:test`, run via
  `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test <file>`.
- Frontend tests: Vitest, run via `cd frontend && npx vitest run <file>`.
- Never use `exec`/`shell: true` for the `osascript` call — always
  `execFile` with an argv array, per `AGENTS.md`'s security guidance on not
  weakening safety boundaries.
- Match existing code style: no comments except where a non-obvious
  constraint needs explaining (see `src/server.ts`'s existing header
  comment style and `src/agent/backendPool.ts`'s file-level comment for the
  bar to clear).

---

### Task 1: Backend — native folder-picker module + injectable seam

**Files:**
- Create: `src/pickFolder.ts`
- Test: `src/pickFolder.test.ts`

**Interfaces:**
- Produces: `PickFolderFn` type and `pickFolderNative: PickFolderFn`, where
  ```ts
  export type PickFolderResult = { cancelled: boolean; cwd: string | null };
  export type PickFolderFn = (initialCwd?: string) => Promise<PickFolderResult>;
  ```
  `pickFolderNative` is the real `osascript`-backed implementation. Task 2
  imports both the type and the real implementation.
- Also produces (exported for the test in this task, and reused nowhere
  else): `buildChooseFolderScript(initialCwd?: string): string` — pure
  string-building/escaping helper, no I/O.

- [ ] **Step 1: Write the failing test for the pure script-builder**

```ts
// src/pickFolder.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChooseFolderScript } from "./pickFolder";

test("buildChooseFolderScript with no initialCwd", () => {
  const script = buildChooseFolderScript();
  assert.equal(
    script,
    'POSIX path of (choose folder with prompt "Select a workspace folder")',
  );
});

test("buildChooseFolderScript escapes quotes and backslashes in initialCwd", () => {
  const script = buildChooseFolderScript('/Users/bob/weird"path\\here');
  assert.equal(
    script,
    'POSIX path of (choose folder with prompt "Select a workspace folder" default location (POSIX file "/Users/bob/weird\\"path\\\\here"))',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/pickFolder.test.ts`
Expected: FAIL — `Cannot find module './pickFolder'` (file doesn't exist yet).

- [ ] **Step 3: Write `src/pickFolder.ts`**

```ts
// Native macOS folder picker. Shells out to osascript's "choose folder"
// dialog and returns a real absolute path — something a browser-side folder
// picker cannot do, since browsers deliberately withhold real filesystem
// paths from JS. Only meaningful on darwin; callers gate on
// process.platform before invoking this.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

export type PickFolderResult = { cancelled: boolean; cwd: string | null };
export type PickFolderFn = (initialCwd?: string) => Promise<PickFolderResult>;

function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildChooseFolderScript(initialCwd?: string): string {
  let inner = 'choose folder with prompt "Select a workspace folder"';
  if (initialCwd) {
    inner += ` default location (POSIX file "${escapeAppleScriptString(initialCwd)}")`;
  }
  return `POSIX path of (${inner})`;
}

export const pickFolderNative: PickFolderFn = async (initialCwd) => {
  let effectiveInitialCwd: string | undefined;
  if (initialCwd) {
    const stat = await fs.stat(initialCwd).catch(() => null);
    if (stat?.isDirectory()) effectiveInitialCwd = initialCwd;
  }
  const script = buildChooseFolderScript(effectiveInitialCwd);
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return { cancelled: false, cwd: stdout.trim() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("-128") || /user canceled/i.test(message)) {
      return { cancelled: true, cwd: null };
    }
    throw err;
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/pickFolder.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pickFolder.ts src/pickFolder.test.ts
git commit -m "feat: add native macOS folder-picker module"
```

---

### Task 2: Backend — finish `POST /chat/pick-folder`

> **Note:** a merge landed on `main` after this plan's spec was written
> (`146e172`, "reconcile Claude ACP backend branch with session-history-restore
> work") that replaced `src/server.ts`'s `chatBackend`/`backendPool`/
> `autoApprove` options with a single `registry: BackendRegistry`
> (`src/agent/backendRegistry.ts`), and `src/server.test.ts`'s `withServer`
> helper now builds a hand-rolled `BackendRegistry`-shaped test double
> (`makeSingleBackendTestRegistry`) instead of a real `BackendPool`. The step
> below is written against that current shape — verify by reading
> `src/server.ts` lines 1-40 and `src/server.test.ts` lines 1-78 before
> editing, in case something has moved again.

**Files:**
- Modify: `src/server.ts` (the stub currently at lines 386-388, and
  `CreateServerOptions` at lines 13-18)
- Modify: `src/server.test.ts` (the `withServer` helper at lines 14-45;
  append new tests after the existing ones)

**Interfaces:**
- Consumes: `PickFolderFn`, `pickFolderNative` from Task 1 (`src/pickFolder.ts`).
- Produces: route `POST /chat/pick-folder` responding
  `{ ok: true, cancelled: boolean, cwd: string | null }` on success paths,
  `501 { error: string }` off-macOS, `500 { ok: false, error: string }` on
  an unexpected `pickFolder` rejection. Also produces
  `CreateServerOptions.pickFolder?: PickFolderFn` (optional, defaults to
  `pickFolderNative`) — this is the seam Task 2's own tests use, by passing
  a fake through `withServer`.

- [ ] **Step 1: Extend `withServer`'s server-construction call to accept an
  optional `pickFolder` override**

In `src/server.test.ts`, the current `withServer` helper (lines 14-45) reads:

```ts
async function withServer<T>(
  setup: (workspace: string) => Promise<{
    backend: FakeBackend;
    fn: (url: string) => Promise<T>;
  }>,
): Promise<T> {
  const ws = await mkWorkspace();
  try {
    const { backend, fn } = await setup(ws);
    const testRegistry = makeSingleBackendTestRegistry(backend);
    const tools = createToolRegistry(ws);
    const app = createServer({ workspace: ws, port: 0, registry: testRegistry, tools });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      return await fn(url);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
}
```

Change it to thread through an optional `pickFolder` override:

```ts
async function withServer<T>(
  setup: (workspace: string) => Promise<{
    backend: FakeBackend;
    fn: (url: string) => Promise<T>;
    pickFolder?: import("./pickFolder").PickFolderFn;
  }>,
): Promise<T> {
  const ws = await mkWorkspace();
  try {
    const { backend, fn, pickFolder } = await setup(ws);
    const testRegistry = makeSingleBackendTestRegistry(backend);
    const tools = createToolRegistry(ws);
    const app = createServer({
      workspace: ws,
      port: 0,
      registry: testRegistry,
      tools,
      ...(pickFolder ? { pickFolder } : {}),
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      return await fn(url);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
}
```

(Only the type signature and the `createServer({...})` call change — the
`makeSingleBackendTestRegistry` function below it, and everything else in
the file, is untouched.)

- [ ] **Step 2: Write the failing tests**

Append to `src/server.test.ts`:

```ts
test("POST /chat/pick-folder returns the picked path", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    pickFolder: async () => ({ cancelled: false, cwd: "/tmp/picked-folder" }),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/pick-folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; cancelled: boolean; cwd: string | null };
      assert.equal(body.ok, true);
      assert.equal(body.cancelled, false);
      assert.equal(body.cwd, "/tmp/picked-folder");
    },
  }));
});

test("POST /chat/pick-folder returns cancelled with a null cwd", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    pickFolder: async () => ({ cancelled: true, cwd: null }),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/pick-folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; cancelled: boolean; cwd: string | null };
      assert.equal(body.ok, true);
      assert.equal(body.cancelled, true);
      assert.equal(body.cwd, null);
    },
  }));
});

test("POST /chat/pick-folder passes initialCwd through to the picker", async () => {
  let receivedInitialCwd: string | undefined;
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    pickFolder: async (initialCwd) => {
      receivedInitialCwd = initialCwd;
      return { cancelled: false, cwd: initialCwd ?? null };
    },
    fn: async (url) => {
      await fetch(`${url}/chat/pick-folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initialCwd: "/tmp/last-workspace" }),
      });
      assert.equal(receivedInitialCwd, "/tmp/last-workspace");
    },
  }));
});

test("POST /chat/pick-folder returns 500 when the picker rejects", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    pickFolder: async () => { throw new Error("osascript exploded"); },
    fn: async (url) => {
      const res = await fetch(`${url}/chat/pick-folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 500);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /osascript exploded/);
    },
  }));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: the 4 new tests FAIL (route still returns the old unconditional
501 stub, so `body.ok`/`body.cancelled`/`body.cwd` assertions fail or the
status code doesn't match).

- [ ] **Step 4: Implement the route**

In `src/server.ts`:

1. Add the import near the top (with the other imports):
```ts
import type { PickFolderFn } from "./pickFolder";
import { pickFolderNative } from "./pickFolder";
```

2. Extend `CreateServerOptions` (currently lines 13-18):
```ts
export interface CreateServerOptions {
  workspace: string;
  port: number;
  registry: BackendRegistry;
  tools: Map<string, ToolHandler>;
  pickFolder?: PickFolderFn;
}
```

3. In the `createServer` function body, destructure it with a default
   (currently lines 30-34):
```ts
const {
  workspace,
  registry,
  tools,
  pickFolder = pickFolderNative,
} = opts;
```

4. Replace the stub (currently lines 386-388):
```ts
app.post("/chat/pick-folder", (_req, res) => {
  res.status(501).json({ error: "folder picker not supported on this platform" });
});
```
with:
```ts
app.post("/chat/pick-folder", smallJson, asyncRoute(async (req, res) => {
  if (process.platform !== "darwin") {
    res.status(501).json({ error: "folder picker not supported on this platform" });
    return;
  }
  const body = PickFolderBodySchema.parse(req.body ?? {});
  try {
    const result = await pickFolder(body.initialCwd);
    res.json({ ok: true, cancelled: result.cancelled, cwd: result.cwd });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "pick-folder failed" });
  }
}));
```

5. Add the schema near the other `*Schema = z.object(...)` definitions at
   the bottom of the file (alongside `CancelBodySchema`, `ForkBodySchema`,
   etc.):
```ts
const PickFolderBodySchema = z.object({ initialCwd: z.string().optional() });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: PASS (all tests in the file, including the 4 new ones).

Note: this test run happens on whatever platform CI/you are on. Since the
injected fake `pickFolder` fully replaces `pickFolderNative`, these 4 tests
never depend on `process.platform === "darwin"` — the route's platform
guard only applies when no `pickFolder` override is supplied and it falls
through to the real implementation, which none of these tests do. No
platform-guard test is included because gating the guard itself behind an
injectable seam (e.g. an `isDarwin` option) would add complexity purely for
one branch's coverage — the guard is a single `if` already covered by
reading the code, and the archived doc + this plan's Task 3 exercise the
darwin path manually (see Task 3's manual verification step).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: implement POST /chat/pick-folder via native macOS dialog"
```

---

### Task 3: Frontend — `useChat.startNewChatInWorkspace` + `ChatContext.init(cwd)`

**Files:**
- Modify: `frontend/src/state/ChatContext.tsx`
- Modify: `frontend/src/state/useChat.ts`
- Modify: `frontend/src/state/useChat.test.tsx` (append test)

**Interfaces:**
- Consumes: existing `ChatContextApi.init(sessionId?: string | null)`,
  `fetchJSON` from `frontend/src/api/client.ts`.
- Produces: `ChatContextApi.init(sessionId?: string | null, cwd?: string):
  Promise<void>` (signature change — the added second param is optional so
  every existing call site, e.g. `init(null)`, `init(sessionId)`, stays
  valid unchanged). Produces `useChat().startNewChatInWorkspace(cwd:
  string): Promise<void>`, consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/state/useChat.test.tsx` (inside the existing
`describe("useChat", ...)` block, after the `"cancel aborts the stream"`
test):

```ts
  it("startNewChatInWorkspace inits with the given cwd and resets the transcript", async () => {
    fetchJSONSpy.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...baseInit, cwd: "/Users/bob/projects/foo" },
    });
    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    await act(async () => { await result.current.startNewChatInWorkspace("/Users/bob/projects/foo"); });
    expect(fetchJSONSpy).toHaveBeenCalledWith(
      expect.stringContaining("cwd=%2FUsers%2Fbob%2Fprojects%2Ffoo"),
    );
    expect(result.current.transcript).toHaveLength(0);
    expect(result.current.context.state.cwd).toBe("/Users/bob/projects/foo");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/state/useChat.test.tsx`
Expected: FAIL — `result.current.startNewChatInWorkspace is not a function`.

- [ ] **Step 3: Add the `cwd` param to `ChatContextApi.init`**

In `frontend/src/state/ChatContext.tsx`, update the `init` signature (the
existing implementation, currently around lines 70-92):

```ts
  const init = useCallback(async (sessionId: string | null = null, cwd?: string) => {
    const params = new URLSearchParams();
    if (sessionId) params.set("sessionId", sessionId);
    if (cwd) params.set("cwd", cwd);
    const url = params.toString() ? `/chat/init?${params.toString()}` : "/chat/init";
    const res = await fetchJSON<ChatInitResponse>(url);
```

(leave the rest of the function body — everything from `if (!res.ok ...`
downward — exactly as-is).

Update the `ChatContextApi` interface's `init` entry (currently `init:
(sessionId?: string | null) => Promise<void>;`) to:
```ts
  init: (sessionId?: string | null, cwd?: string) => Promise<void>;
```

- [ ] **Step 4: Add `startNewChatInWorkspace` to `useChat`**

In `frontend/src/state/useChat.ts`, add a new callback right after
`startNewChat` (currently lines 107-112):

```ts
  const startNewChatInWorkspace = useCallback(async (cwd: string) => {
    if (ctx.state.busy) cancel();
    setTranscript([]);
    await ctx.init(null, cwd);
    const base = cwd.split("/").filter(Boolean).pop() ?? cwd;
    ctx.setTitle(`Chat: ${base}`);
  }, [ctx, cancel]);
```

Add it to the `UseChatResult` interface (after `startNewChat: () =>
Promise<void>;`):
```ts
  startNewChatInWorkspace: (cwd: string) => Promise<void>;
```

Add it to the returned object at the bottom of the hook (after
`startNewChat,`):
```ts
    startNewChatInWorkspace,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/state/useChat.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/state/ChatContext.tsx frontend/src/state/useChat.ts frontend/src/state/useChat.test.tsx
git commit -m "feat(frontend): add startNewChatInWorkspace and cwd-aware init"
```

---

### Task 4: Frontend — "+ New in..." button in `ChatPanel`

> **Note:** the same merge mentioned in Task 2 (`146e172`) also grew
> `ChatPanel.test.tsx` since this plan's spec was written — it now has a
> `describe("deleting the active session", ...)` block (lines 28-76) that
> mocks `fetchJSON` with a `mockImplementation` dispatching on URL/method
> and uses `waitFor`, not just the two bare unmocked-render tests from
> before. The steps below follow that established, richer pattern rather
> than relying on an unmocked fetch silently failing. Re-read
> `frontend/src/components/ChatPanel.test.tsx` in full before editing, in
> case it has grown further.

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/components/ChatPanel.test.tsx` (append tests)

**Interfaces:**
- Consumes: `chat.startNewChatInWorkspace(cwd: string)` from Task 3,
  `fetchJSON` from `../api/client`, `useToast` from `../state/ToastContext`
  (already imported in this file as `toast`).
- Produces: nothing new for later tasks — this is the last task.

`localStorage` key used: `"jarvis.lastWorkspace"` (matches the
`"jarvis.quickPhrases"` convention already in
`frontend/src/components/SettingsPanel.tsx`).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/ChatPanel.test.tsx`, as a new
`describe` block alongside the existing `describe("deleting the active
session", ...)` block (both live inside the outer `describe("<ChatPanel>",
...)`):

```ts
  it("renders a disabled '+ New in...' button by default (no capabilities yet)", () => {
    render(
      <ToastProvider>
        <ChatPanel />
      </ToastProvider>,
    );
    const button = screen.getByText("+ New in...") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  describe("'+ New in...' workspace picker", () => {
    let fetchJSONSpy: ReturnType<typeof vi.spyOn>;

    const baseInit: ChatInitResponse = {
      ok: true,
      backend: { kind: "fake", role: "chat", model: null },
      sessionId: "sess-1",
      cwd: "/tmp/ws",
      resumed: false,
      capabilities: {
        multipleSessions: true, customWorkingDirectory: true, cancel: true, steer: false,
        toolApprovals: true, slashCommands: false, canFork: true, images: false,
        sessionDelete: true, promptQueueing: false,
      },
      slashCommands: [], history: [],
      autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
      model: { supported: false, available: [], current: null },
    };

    beforeEach(() => {
      fetchJSONSpy = vi.spyOn(client, "fetchJSON").mockImplementation(async (url: string, opts?: { method?: string }) => {
        if (url.startsWith("/chat/init")) {
          const cwd = url.includes("cwd=") ? decodeURIComponent(url.split("cwd=")[1]) : baseInit.cwd;
          return { ok: true, status: 200, data: { ...baseInit, cwd } };
        }
        if (url === "/chat/pick-folder" && opts?.method === "POST") {
          return { ok: true, status: 200, data: { ok: true, cancelled: false, cwd: "/Users/bob/projects/foo" } };
        }
        return { ok: true, status: 200, data: {} };
      });
    });

    afterEach(() => { fetchJSONSpy.mockRestore(); });

    it("enables the button once customWorkingDirectory is supported, and starts a chat in the picked folder", async () => {
      render(
        <ToastProvider>
          <ChatPanel />
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByText("New chat")).toBeInTheDocument());
      const button = await waitFor(() => {
        const b = screen.getByText("+ New in...") as HTMLButtonElement;
        expect(b.disabled).toBe(false);
        return b;
      });

      fireEvent.click(button);

      await waitFor(() => expect(screen.getByText("Chat: foo")).toBeInTheDocument());
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx`
Expected: FAIL — `Unable to find an element with the text: + New in...`
(both new tests fail; the existing "deleting the active session" tests are
unaffected)

- [ ] **Step 3: Implement the button**

In `frontend/src/components/ChatPanel.tsx`:

1. Add a local state var near the other `useState` calls at the top of
   `ChatPanelInner` (after `const [pinned, setPinned] = useState(false);`):
```ts
  const [pickingFolder, setPickingFolder] = useState(false);
```

2. Add the click handler, right after the existing `onNewChat` callback
   (currently lines 208-210):
```ts
  const LAST_WORKSPACE_KEY = "jarvis.lastWorkspace";

  const onNewChatInWorkspace = useCallback(async () => {
    setPickingFolder(true);
    try {
      const initialCwd = localStorage.getItem(LAST_WORKSPACE_KEY) ?? undefined;
      const res = await fetchJSON<{ ok: boolean; cancelled: boolean; cwd: string | null; error?: string }>(
        "/chat/pick-folder",
        { method: "POST", body: { initialCwd } },
      );
      if (!res.ok || !res.data?.ok) {
        toast.push(res.data?.error ?? "Folder picker unavailable", "error");
        return;
      }
      if (res.data.cancelled || !res.data.cwd) return;
      await chat.startNewChatInWorkspace(res.data.cwd);
      localStorage.setItem(LAST_WORKSPACE_KEY, res.data.cwd);
    } finally {
      setPickingFolder(false);
    }
  }, [chat, toast]);
```

Note: `LAST_WORKSPACE_KEY` is declared as a `const` inside the component
body here for locality with its one usage; if a second consumer of this key
appears later, hoist it to module scope then — not needed yet (YAGNI).

3. Add the button in the header JSX, right after the existing `+ New`
   button (currently line 220):
```tsx
            <button onClick={onNewChat}>+ New</button>
            <button
              onClick={onNewChatInWorkspace}
              disabled={!ctx.state.capabilities?.customWorkingDirectory || chat.busy || pickingFolder}
            >
              + New in...
            </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Typecheck and full frontend test suite**

Run: `cd frontend && npm run typecheck && npx vitest run`
Expected: no errors, all tests pass.

- [ ] **Step 6: Manual verification (macOS only, this repo's platform)**

Run: `npm run dev` (backend) and in another terminal `npm run dev:web`
(frontend), then in the browser: click "+ New in...", confirm a native
Finder "choose folder" dialog appears, pick a folder, confirm the chat
title updates to that folder's basename and a fresh empty transcript
appears. Click "+ New in..." again and confirm the dialog opens
pre-navigated to the previously picked folder. Click "+ New in...", then
Cancel in the dialog, and confirm nothing changes (no toast, no new
session).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/components/ChatPanel.test.tsx
git commit -m "feat(frontend): add '+ New in...' workspace picker button"
```

---

## Post-implementation doc check

This changes `/chat/pick-folder`'s behavior from an unconditional 501 stub
to a real implementation, which the archived doc
`docs/archives/implementation/03-http-api.md:153-155` already describes
correctly — no change needed there. `docs/acp-notes.md` and the
"Don't-touch" zones in `AGENTS.md` are unaffected (this plan never touches
`src/agent/acp/index.ts`). No `docs/` update is required since no
document currently describes `/chat/pick-folder` as a stub that needs
correcting.
