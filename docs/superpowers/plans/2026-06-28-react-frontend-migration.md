# React + Vite Frontend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vanilla `public/` SPA with a React 18 + TypeScript + Vite frontend, keeping the backend, all HTTP endpoints, the SSE patch protocol, and the `:root` design-token names unchanged.

**Architecture:** New Vite project at `frontend/`. Vite dev server on `:5173` proxies `/chat`, `/health`, `/status`, `/workspace`, `/skills`, `/slack`, `/analytics`, `/tools` to the existing backend on `:3001`. Vite `build.outDir = '../public'` writes production output into the directory Express serves via `express.static`. State lives in `useState` + React Context; SSE consumed via a `useSSE` hook; markdown rendered via `react-markdown` with `rehype-sanitize`. Each component lives in its own folder with a scoped `.module.css`.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Vitest 2, @testing-library/react 16, react-markdown 9, remark-gfm 4, rehype-sanitize 6.

**Reference:** [Design spec](../../superpowers/specs/2026-06-28-react-frontend-migration-design.md) at `docs/superpowers/specs/`.

---

## Phase A — Bootstrap

### Task 1: Add npm dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime + dev deps**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
npm install --save react@^18 react-dom@^18 react-markdown@^9 remark-gfm@^4 rehype-sanitize@^6
npm install --save-dev vite@^5 @vitejs/plugin-react@^4 vitest@^2 \
  @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25 \
  @types/react@^18 @types/react-dom@^18
```

- [ ] **Step 2: Add scripts to package.json**

Add to `"scripts"` (keep existing `dev`, `build`, `start`, `test`, `typecheck`):

```json
"dev:web": "cd frontend && npm run dev",
"build:web": "cd frontend && npm run build",
"preview:web": "cd frontend && npm run preview",
"test:web": "cd frontend && npm test -- --run"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add package.json package-lock.json
git commit -m "deps: add React + Vite toolchain"
```

---

### Task 2: Vite project skeleton

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx` (placeholder)
- Create: `frontend/src/App.tsx` (placeholder)
- Create: `frontend/src/test-setup.ts`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "jarvis-bridge-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `frontend/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `frontend/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "../public", emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      "/chat": "http://localhost:3001",
      "/health": "http://localhost:3001",
      "/status": "http://localhost:3001",
      "/workspace": "http://localhost:3001",
      "/skills": "http://localhost:3001",
      "/slack": "http://localhost:3001",
      "/analytics": "http://localhost:3001",
      "/tools": "http://localhost:3001",
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
});
```

- [ ] **Step 5: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jarvis Bridge</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `frontend/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7: Create `frontend/src/App.tsx`**

```tsx
export function App() {
  return <div>Jarvis Bridge — booting…</div>;
}
```

- [ ] **Step 8: Create `frontend/src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 9: Verify dev server boots**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vite --port 5174 &
VITE_PID=$!
sleep 4
curl -sS http://127.0.0.1:5174/ | head -10
kill $VITE_PID 2>/dev/null
```

Expected: HTML containing `<div id="root">`.

- [ ] **Step 10: Restore vanilla public/ (we'll let Vite overwrite it for real later)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git checkout -- public/
```

- [ ] **Step 11: Commit skeleton**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/
git commit -m "feat(frontend): scaffold Vite + React + TypeScript project at frontend/"
```

---

### Task 3: Global styles + design tokens

**Files:**
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/global.css`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Create `frontend/src/styles/tokens.css`** (copy `:root` block from `public/css/app.css`)

```css
:root {
  --color-bg: #11161b;
  --color-surface-1: #182027;
  --color-surface-2: #202a33;
  --color-surface-3: #2a3640;
  --color-text: #e6edf3;
  --color-text-muted: #8b98a5;
  --color-border: #2c3742;
  --color-border-strong: #4a5862;
  --color-accent: #4ea3ff;
  --color-accent-strong: #2d8cff;
  --color-accent-tint: rgba(78, 163, 255, 0.15);
  --color-success: #3fb950;
  --color-warning: #d29922;
  --color-danger: #f85149;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.3);
  --sidenav-w: 220px;
  --chat-composer-h: 96px;
  --header-h: 44px;
}
```

- [ ] **Step 2: Create `frontend/src/styles/global.css`**

```css
@import "./tokens.css";

*, *::before, *::after { box-sizing: border-box; }

html, body, #root { height: 100%; margin: 0; padding: 0; }

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
}

button { font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  padding: 4px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--color-border-strong); background: var(--color-surface-1); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: var(--color-accent); border-color: var(--color-accent-strong); color: #001020; font-weight: 600; }
button.primary:hover:not(:disabled) { background: var(--color-accent-strong); }
button.danger { border-color: var(--color-danger); color: var(--color-danger); }

input, textarea, select { font: inherit; color: inherit; background: var(--color-surface-1);
  border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 6px 8px; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--color-accent); }

textarea { resize: vertical; }
code, pre { font-family: var(--font-mono); font-size: 13px; }
pre { background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 8px 10px; overflow-x: auto; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--color-bg); }
::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: var(--radius-sm); }
::-webkit-scrollbar-thumb:hover { background: var(--color-border-strong); }
```

- [ ] **Step 3: Update `frontend/src/main.tsx` to import global.css**

Add `import "./styles/global.css";` at the top (after React imports).

- [ ] **Step 4: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/styles/ frontend/src/main.tsx
git commit -m "feat(frontend): design tokens + global styles (Phase 4 token block)"
```

---

### Task 4: API types (mirror server's ChatPatch union)

**Files:**
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/api/types.test.ts`

- [ ] **Step 1: Write failing test `frontend/src/api/types.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { ChatPatch } from "./types";

describe("ChatPatch type", () => {
  it("narrows text-start correctly", () => {
    const p: ChatPatch = { type: "text-start", index: 0, content: "hi" };
    if (p.type === "text-start") {
      expect(p.content).toBe("hi");
    } else {
      throw new Error("not text-start");
    }
  });
  it("narrows tool-call-start correctly", () => {
    const p: ChatPatch = {
      type: "tool-call-start",
      index: 1,
      toolCallId: "tc-1",
      toolName: "bash",
      argsInitial: "ls",
    };
    expect(p.toolName).toBe("bash");
  });
  it("narrows approval-request correctly", () => {
    const p: ChatPatch = {
      type: "approval-request",
      requestId: "r1",
      toolCallId: "tc-1",
      toolName: "bash",
      options: [{ id: "allow_once", name: "Allow once" }],
    };
    expect(p.options[0].id).toBe("allow_once");
  });
});
```

- [ ] **Step 2: Run test (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/api/types.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/api/types.ts`**

Mirror the server's `src/agent/types.ts` ChatPatch union. Use the exact same field names so the SSE contract is one-to-one:

```ts
export interface AgentCapabilities {
  multipleSessions: boolean;
  customWorkingDirectory: boolean;
  cancel: boolean;
  steer: boolean;
  toolApprovals: boolean;
  slashCommands: boolean;
  canFork: boolean;
  images: boolean;
}

export interface SlashCommand { name: string; description?: string; }
export interface ModelInfo { modelId: string; name: string; }
export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt?: string | null;
  cwd?: string;
  customTitle?: string;
  pinned?: boolean;
  group?: string;
  active?: boolean;
}

export interface AutoApproveState {
  supported: boolean;
  default: boolean;
  override: boolean | null;
  effective: boolean;
  enabled: boolean;
}

export interface ChatInitResponse {
  ok: true;
  backend: { kind: string; role: string; model: string | null };
  sessionId: string;
  cwd: string;
  contextInjectionEnabled: boolean;
  resumed: boolean;
  capabilities: AgentCapabilities;
  slashCommands: SlashCommand[];
  history: ChatHistoryEntry[];
  autoApprove: AutoApproveState;
  model: { supported: boolean; available: ModelInfo[]; current: string | null };
}

export type ChatHistoryEntry =
  | { kind: "user"; content: string }
  | { kind: "assistant"; patches: ChatPatch[] };

export type ChatPatch =
  | { type: "text-start"; index: number; content: string }
  | { type: "text-delta"; index: number; delta: string }
  | { type: "thought-start"; index: number; content: string }
  | { type: "thought-delta"; index: number; delta: string }
  | { type: "tool-call-start"; index: number; toolCallId: string | null; toolName: string; argsInitial: string }
  | { type: "tool-call-name-delta"; index: number; delta: string }
  | { type: "tool-call-args-delta"; index: number; delta: string }
  | { type: "tool-call-finalized"; index: number; toolCallId: string | null; args: unknown; argsRaw?: string; intent?: string }
  | { type: "tool-return"; toolCallId: string | null; content: unknown }
  | { type: "tool-error"; toolCallId: string | null; content: string }
  | { type: "tool-return-orphan"; toolName?: string; content: unknown }
  | { type: "usage"; usage: UsageTotals }
  | { type: "error"; message: string }
  | { type: "slash-commands"; commands: SlashCommand[] }
  | { type: "approval-request"; requestId: string; toolCallId: string | null; toolName: string; toolKind?: string; toolInput?: unknown; options: Array<{ id: string; name?: string; kind?: string }> }
  | { type: "steer-ack"; accepted: boolean; reason?: string }
  | { type: "images-skipped"; skipped: Array<{ filename?: string; mimeType: string; reason: "too-large" | "unsupported" | "decode-error" }> }
  | { type: "done" };

export interface UsageTotals {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  context_limit?: number;
  context_used?: number;
  cost?: { amount: number; currency: string };
  thought_tokens?: number;
}

export interface ImageAttachment {
  data: string;
  mimeType: string;
  filename?: string;
}
```

- [ ] **Step 4: Run test (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/api/types.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/api/types.ts frontend/src/api/types.test.ts
git commit -m "feat(frontend): ChatPatch + API response types"
```

---

### Task 5: API client (fetchJSON + fetchSSE)

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write failing test `frontend/src/api/client.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJSON } from "./client";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchJSON", () => {
  it("parses a JSON 200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await fetchJSON("/test");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, value: 42 });
  });

  it("stringifies a body object", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = spy;
    await fetchJSON("/test", { method: "POST", body: { x: 1 } });
    expect(spy).toHaveBeenCalledWith("/test", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json" }),
      body: JSON.stringify({ x: 1 }),
    }));
  });

  it("returns status on 4xx without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "no" }), { status: 404 }),
    );
    const res = await fetchJSON("/missing");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.data).toEqual({ error: "no" });
  });

  it("falls back to text when body isn't JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("plain text", { status: 200 }));
    const res = await fetchJSON("/text");
    expect(res.data).toBe("plain text");
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/api/client.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/api/client.ts`**

```ts
export interface FetchOpts extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export interface FetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function fetchJSON<T = unknown>(
  url: string,
  opts: FetchOpts = {},
): Promise<FetchResult<T>> {
  const { body, headers, ...rest } = opts;
  const finalHeaders = new Headers(headers);
  let finalBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (typeof body === "string") {
      finalBody = body;
    } else {
      finalBody = JSON.stringify(body);
      finalHeaders.set("content-type", "application/json");
    }
  }
  const res = await fetch(url, { ...rest, headers: finalHeaders, body: finalBody });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

export interface SSEHandle {
  abort: () => void;
  done: Promise<void>;
}

export function fetchSSE<T = unknown>(
  url: string,
  body: object,
  handlers: {
    onPatch: (p: T) => void;
    onDone?: () => void;
    onError?: (err: Error) => void;
  },
): SSEHandle {
  const controller = new AbortController();
  let aborted = false;
  const done = (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => String(res.status));
        handlers.onError?.(new Error(`SSE failed: ${res.status} ${errText}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let sawDone = false;
      while (!aborted) {
        const { value, done: rdone } = await reader.read();
        if (rdone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const patch = JSON.parse(json) as T & { type?: string };
            if (patch && patch.type === "done") {
              sawDone = true;
              handlers.onPatch(patch);
              handlers.onDone?.();
              return;
            }
            handlers.onPatch(patch);
          } catch {
            // skip malformed line; resync on next iteration
          }
        }
      }
      if (!sawDone) {
        handlers.onPatch({ type: "done" } as unknown as T);
        handlers.onDone?.();
      }
    } catch (err) {
      if (aborted) return;
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return {
    abort: () => { aborted = true; controller.abort(); },
    done,
  };
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/api/client.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): typed fetchJSON + fetchSSE stream consumer"
```

---

### Task 6: Routes + useHashRoute

**Files:**
- Create: `frontend/src/routes.ts`
- Create: `frontend/src/useHashRoute.ts`
- Create: `frontend/src/useHashRoute.test.ts`

- [ ] **Step 1: Write failing test `frontend/src/useHashRoute.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHashRoute, parseHash } from "./useHashRoute";

describe("parseHash", () => {
  it("defaults to chat on empty hash", () => {
    expect(parseHash("")).toBe("chat");
    expect(parseHash("#")).toBe("chat");
  });
  it("parses simple routes", () => {
    expect(parseHash("#status")).toBe("status");
    expect(parseHash("#settings")).toBe("settings");
    expect(parseHash("#chat")).toBe("chat");
    expect(parseHash("#skills-manage")).toBe("skills-manage");
  });
  it("parses skill/<name>", () => {
    expect(parseHash("#skill/chatgpt")).toBe("skill/chatgpt");
  });
  it("falls back to chat on unknown", () => {
    expect(parseHash("#bogus")).toBe("chat");
  });
});

describe("useHashRoute", () => {
  beforeEach(() => { window.location.hash = ""; });
  afterEach(() => { window.location.hash = ""; });

  it("returns initial route from current hash", () => {
    window.location.hash = "#status";
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe("status");
  });

  it("navigate updates hash and state", () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => result.current.navigate("settings"));
    expect(result.current.route).toBe("settings");
  });

  it("reacts to hashchange event", () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => {
      window.location.hash = "#status";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.route).toBe("status");
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/useHashRoute.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/routes.ts`**

```ts
export const ROUTES = ["chat", "status", "skills-manage", "settings"] as const;
export type Route = (typeof ROUTES)[number] | `skill/${string}`;
```

- [ ] **Step 4: Implement `frontend/src/useHashRoute.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import type { Route } from "./routes";
import { ROUTES } from "./routes";

export function parseHash(raw: string): Route {
  const h = (raw || "").replace(/^#/, "");
  if (!h) return "chat";
  if ((ROUTES as readonly string[]).includes(h)) return h as Route;
  if (h.startsWith("skill/") && h.length > "skill/".length) return h as Route;
  return "chat";
}

export function useHashRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? "chat" : parseHash(window.location.hash),
  );
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((r: Route) => {
    const next = r === "chat" ? "" : `#${r}`;
    const cur = window.location.hash;
    const desired = next || "";
    if (cur !== desired) {
      if (next) window.location.hash = next;
      else history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);
  return { route, navigate };
}
```

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/useHashRoute.test.ts
```

Expected: PASS (7/7).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/routes.ts frontend/src/useHashRoute.ts frontend/src/useHashRoute.test.ts
git commit -m "feat(frontend): routes + custom hash router hook"
```

---

## Phase B — State (ChatContext, useChat, useSSE, Toasts)

### Task 7: ToastContext + Toasts component

**Files:**
- Create: `frontend/src/state/ToastContext.tsx`
- Create: `frontend/src/state/ToastContext.module.css`
- Create: `frontend/src/state/ToastContext.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/state/ToastContext.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider, useToast } from "./ToastContext";

describe("ToastContext", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("push adds a toast", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.push("hello", "info"));
    act(() => result.current.push("oh no", "error"));
    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.toasts[0].message).toBe("hello");
    expect(result.current.toasts[1].kind).toBe("error");
  });

  it("info toasts auto-dismiss after 4s", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.push("x", "info"));
    expect(result.current.toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(4100));
    expect(result.current.toasts).toHaveLength(0);
  });

  it("error toasts are sticky", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.push("boom", "error"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.toasts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/state/ToastContext.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/state/ToastContext.tsx`**

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import styles from "./ToastContext.module.css";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind, opts?: { durationMs?: number }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION: Record<ToastKind, number | null> = {
  info: 4000,
  success: 3000,
  warning: 5000,
  error: null,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
  }, []);

  const push = useCallback<ToastApi["push"]>((message, kind = "info", opts = {}) => {
    const id = idRef.current++;
    setToasts((cur) => [...cur, { id, message, kind }]);
    const ttl = opts.durationMs !== undefined ? opts.durationMs : DEFAULT_DURATION[kind];
    if (ttl !== null) {
      const handle = setTimeout(() => dismiss(id), ttl);
      timersRef.current.set(id, handle);
    }
  }, [dismiss]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => { timers.forEach((h) => clearTimeout(h)); timers.clear(); };
  }, []);

  const api = useMemo<ToastApi>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.stack} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.kind]}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
```

- [ ] **Step 4: Implement `frontend/src/state/ToastContext.module.css`**

```css
.stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 200;
  max-width: 360px;
}
.toast {
  padding: 10px 12px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.error { border-left-color: var(--color-danger); }
.success { border-left-color: var(--color-success); }
.warning { border-left-color: var(--color-warning); }
```

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/state/ToastContext.test.tsx
```

Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/state/ToastContext.tsx frontend/src/state/ToastContext.test.tsx frontend/src/state/ToastContext.module.css
git commit -m "feat(frontend): ToastContext provider + stack component"
```

---

### Task 8: ChatContext (state + init + mutations)

**Files:**
- Create: `frontend/src/state/ChatContext.tsx`
- Create: `frontend/src/state/ChatContext.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/state/ChatContext.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { ChatProvider, useChatContext } from "./ChatContext";
import * as client from "../api/client";
import type { ChatInitResponse } from "../api/types";

const baseInit: ChatInitResponse = {
  ok: true,
  backend: { kind: "fake", role: "chat", model: null },
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  contextInjectionEnabled: true,
  resumed: false,
  capabilities: {
    multipleSessions: true,
    customWorkingDirectory: false,
    cancel: true,
    steer: false,
    toolApprovals: true,
    slashCommands: false,
    canFork: true,
    images: false,
  },
  slashCommands: [],
  history: [],
  autoApprove: {
    supported: true,
    default: false,
    override: null,
    effective: false,
    enabled: false,
  },
  model: { supported: false, available: [], current: null },
};

describe("ChatContext", () => {
  let fetchJSONSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchJSONSpy = vi.spyOn(client, "fetchJSON"); });
  afterEach(() => { fetchJSONSpy.mockRestore(); vi.restoreAllMocks(); });

  it("init sets session + cwd + capabilities", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.sessionId).toBe("sess-1");
    expect(result.current.state.cwd).toBe("/tmp/ws");
    expect(result.current.state.capabilities?.canFork).toBe(true);
  });

  it("init with explicit sessionId calls /chat/init?sessionId=", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: { ...baseInit, sessionId: "pinned" } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init("pinned"); });
    expect(fetchJSONSpy).toHaveBeenCalledWith("/chat/init?sessionId=pinned");
    expect(result.current.state.sessionId).toBe("pinned");
  });

  it("init handles error response", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: false, status: 500, data: { error: "boom" } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.sessionId).toBeNull();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/state/ChatContext.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/state/ChatContext.tsx`**

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { fetchJSON } from "../api/client";
import type {
  AgentCapabilities, AutoApproveState, ChatInitResponse,
  ModelInfo, SlashCommand,
} from "../api/types";

export interface ChatState {
  sessionId: string | null;
  cwd: string | null;
  capabilities: AgentCapabilities | null;
  slashCommands: SlashCommand[];
  models: ModelInfo[];
  currentModel: string | null;
  autoApprove: AutoApproveState;
  busy: boolean;
  title: string;
  resumed: boolean;
}

const INITIAL: ChatState = {
  sessionId: null,
  cwd: null,
  capabilities: null,
  slashCommands: [],
  models: [],
  currentModel: null,
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  busy: false,
  title: "New chat",
  resumed: false,
};

export interface ChatContextApi {
  state: ChatState;
  init: (sessionId?: string | null) => Promise<void>;
  setBusy: (b: boolean) => void;
  setTitle: (t: string) => void;
  setSlashCommands: (cmds: SlashCommand[]) => void;
  setModels: (available: ModelInfo[], current: string | null) => void;
  setAutoApprove: (a: AutoApproveState) => void;
  setSession: (sid: string, cwd: string) => void;
  reset: () => void;
}

const ChatContext = createContext<ChatContextApi | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>(INITIAL);

  const init = useCallback(async (sessionId: string | null = null) => {
    const url = sessionId ? `/chat/init?sessionId=${encodeURIComponent(sessionId)}` : "/chat/init";
    const res = await fetchJSON<ChatInitResponse>(url);
    if (!res.ok || !res.data || !res.data.ok) {
      setState((s) => ({ ...s, sessionId: null }));
      return;
    }
    const d = res.data;
    setState((s) => ({
      ...s,
      sessionId: d.sessionId,
      cwd: d.cwd,
      capabilities: d.capabilities,
      slashCommands: d.slashCommands || [],
      models: d.model?.available || [],
      currentModel: d.model?.current || null,
      autoApprove: d.autoApprove,
      resumed: d.resumed,
    }));
  }, []);

  const setBusy = useCallback((b: boolean) => {
    setState((s) => (s.busy === b ? s : { ...s, busy: b }));
  }, []);
  const setTitle = useCallback((t: string) => setState((s) => ({ ...s, title: t })), []);
  const setSlashCommands = useCallback((cmds: SlashCommand[]) => setState((s) => ({ ...s, slashCommands: cmds })), []);
  const setModels = useCallback((available: ModelInfo[], current: string | null) => {
    setState((s) => ({ ...s, models: available, currentModel: current }));
  }, []);
  const setAutoApprove = useCallback((a: AutoApproveState) => setState((s) => ({ ...s, autoApprove: a })), []);
  const setSession = useCallback((sid: string, cwd: string) => {
    setState((s) => ({ ...s, sessionId: sid, cwd }));
  }, []);
  const reset = useCallback(() => setState(INITIAL), []);

  useEffect(() => { void init(null); }, [init]);

  const api = useMemo<ChatContextApi>(
    () => ({ state, init, setBusy, setTitle, setSlashCommands, setModels, setAutoApprove, setSession, reset }),
    [state, init, setBusy, setTitle, setSlashCommands, setModels, setAutoApprove, setSession, reset],
  );

  return <ChatContext.Provider value={api}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/state/ChatContext.test.tsx
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/state/ChatContext.tsx frontend/src/state/ChatContext.test.tsx
git commit -m "feat(frontend): ChatContext provider — state + init + mutations"
```

---

### Task 9: useSSE hook

**Files:**
- Create: `frontend/src/state/useSSE.ts`
- Create: `frontend/src/state/useSSE.test.ts`

- [ ] **Step 1: Write failing test `frontend/src/state/useSSE.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE } from "./useSSE";
import * as client from "../api/client";

function mockSSE(lines: string[]) {
  vi.spyOn(client, "fetchSSE").mockImplementation((_url, _body, handlers) => {
    let i = 0;
    const interval = setInterval(() => {
      if (i >= lines.length) {
        clearInterval(interval);
        handlers.onDone?.();
        return;
      }
      try {
        const patch = JSON.parse(lines[i]);
        handlers.onPatch(patch);
      } catch {
        handlers.onError?.(new Error("bad json"));
      }
      i++;
    }, 5);
    return { abort: () => clearInterval(interval), done: Promise.resolve() };
  });
}

describe("useSSE", () => {
  it("collects patches from the stream", async () => {
    mockSSE([
      JSON.stringify({ type: "text-start", index: 0, content: "hi" }),
      JSON.stringify({ type: "text-delta", index: 0, delta: " there" }),
      JSON.stringify({ type: "done" }),
    ]);
    const onPatch = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() =>
      useSSE({ url: "/x", body: {}, enabled: true, onPatch, onDone }),
    );
    act(() => result.current.start());
    await new Promise((r) => setTimeout(r, 40));
    expect(onPatch).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("abort stops the stream", async () => {
    mockSSE([JSON.stringify({ type: "text-delta", index: 0, delta: "x" })]);
    const onPatch = vi.fn();
    const { result } = renderHook(() =>
      useSSE({ url: "/x", body: {}, enabled: true, onPatch }),
    );
    act(() => result.current.start());
    act(() => result.current.abort());
    await new Promise((r) => setTimeout(r, 20));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("busy is true while streaming", () => {
    mockSSE([]);
    const { result } = renderHook(() =>
      useSSE({ url: "/x", body: {}, enabled: true, onPatch: vi.fn() }),
    );
    act(() => result.current.start());
    expect(result.current.busy).toBe(true);
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/state/useSSE.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/state/useSSE.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSSE } from "../api/client";

export interface UseSSEOpts<T> {
  url: string;
  body: object;
  enabled: boolean;
  onPatch: (p: T) => void;
  onDone?: () => void;
  onError?: (e: Error) => void;
}

export interface UseSSEResult {
  start: () => void;
  abort: () => void;
  busy: boolean;
}

export function useSSE<T = unknown>(opts: UseSSEOpts<T>): UseSSEResult {
  const [busy, setBusy] = useState(false);
  const handleRef = useRef<ReturnType<typeof fetchSSE> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      handleRef.current?.abort();
      handleRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (!opts.enabled) return;
    if (handleRef.current) handleRef.current.abort();
    setBusy(true);
    handleRef.current = fetchSSE<T>(opts.url, opts.body, {
      onPatch: (p) => { if (!mountedRef.current) return; opts.onPatch(p); },
      onDone: () => {
        if (!mountedRef.current) return;
        setBusy(false);
        handleRef.current = null;
        opts.onDone?.();
      },
      onError: (e) => {
        if (!mountedRef.current) return;
        setBusy(false);
        handleRef.current = null;
        opts.onError?.(e);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);

  const abort = useCallback(() => {
    handleRef.current?.abort();
    handleRef.current = null;
    if (mountedRef.current) setBusy(false);
  }, []);

  return { start, abort, busy };
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/state/useSSE.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/state/useSSE.ts frontend/src/state/useSSE.test.ts
git commit -m "feat(frontend): useSSE hook — POST + consume SSE stream"
```

---

### Task 10: useChat (composes ChatContext + useSSE + transcript)

**Files:**
- Create: `frontend/src/state/useChat.ts`
- Create: `frontend/src/state/useChat.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/state/useChat.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { ChatProvider } from "./ChatContext";
import { useChat } from "./useChat";
import * as client from "../api/client";
import type { ChatInitResponse, ChatPatch } from "../api/types";

const baseInit: ChatInitResponse = {
  ok: true,
  backend: { kind: "fake", role: "chat", model: null },
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  contextInjectionEnabled: true,
  resumed: false,
  capabilities: {
    multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false,
    toolApprovals: true, slashCommands: false, canFork: true, images: false,
  },
  slashCommands: [], history: [],
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  model: { supported: false, available: [], current: null },
};

function wrapperWithChat({ children }: { children: ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}

describe("useChat", () => {
  let fetchJSONSpy: ReturnType<typeof vi.spyOn>;
  let fetchSSESpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => { fetchJSONSpy = vi.spyOn(client, "fetchJSON"); });
  afterEach(() => { fetchSSESpy?.mockRestore(); fetchJSONSpy.mockRestore(); vi.restoreAllMocks(); });

  it("exposes the underlying ChatContext state", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    expect(result.current.context.state.sessionId).toBe("sess-1");
    expect(result.current.busy).toBe(false);
  });

  it("sendMessage collects patches into transcript", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const patches: ChatPatch[] = [
      { type: "text-start", index: 0, content: "hi" },
      { type: "text-delta", index: 0, delta: "!" },
      { type: "done" },
    ];
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockImplementation((_url, _body, handlers) => {
      setTimeout(() => {
        for (const p of patches) handlers.onPatch(p);
        handlers.onDone?.();
      }, 5);
      return { abort: vi.fn(), done: Promise.resolve() };
    });

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    await act(async () => { await result.current.sendMessage("hello"); });
    expect(result.current.transcript).toHaveLength(2);
    expect(result.current.transcript[0]).toEqual({ role: "user", text: "hello" });
    expect(result.current.transcript[1].role).toBe("assistant");
    if (result.current.transcript[1].role === "assistant") {
      expect(result.current.transcript[1].patches).toHaveLength(3);
    }
  });

  it("cancel aborts the stream", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const abortFn = vi.fn();
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockReturnValue({
      abort: abortFn,
      done: new Promise(() => {}),
    });
    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    await act(async () => { await result.current.sendMessage("hi"); });
    act(() => result.current.cancel());
    expect(abortFn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/state/useChat.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/state/useChat.ts`**

```ts
import { useCallback, useRef, useState } from "react";
import { fetchJSON, fetchSSE } from "../api/client";
import type { ChatPatch, ImageAttachment } from "../api/types";
import { useChatContext } from "./ChatContext";

export type TranscriptEntry =
  | { role: "user"; text: string; images?: ImageAttachment[]; queued?: boolean }
  | { role: "assistant"; patches: ChatPatch[] };

export interface UseChatResult {
  context: ReturnType<typeof useChatContext>;
  busy: boolean;
  transcript: TranscriptEntry[];
  sendMessage: (text: string, images?: ImageAttachment[]) => Promise<void>;
  cancel: () => void;
  sendSteer: (text: string) => Promise<void>;
  resolveApproval: (requestId: string, optionId: string) => Promise<void>;
  startNewChat: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  forkCurrent: () => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setAutoApprove: (enabled: boolean) => Promise<void>;
}

export function useChat(): UseChatResult {
  const ctx = useChatContext();
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const sseRef = useRef<ReturnType<typeof fetchSSE> | null>(null);

  const sendMessage = useCallback(
    async (text: string, images: ImageAttachment[] = []) => {
      if (!ctx.state.sessionId) return;
      const userEntry: TranscriptEntry = { role: "user", text, images };
      const assistantEntry: TranscriptEntry = { role: "assistant", patches: [] };
      setTranscript((cur) => [...cur, userEntry, assistantEntry]);
      ctx.setBusy(true);

      sseRef.current?.abort();
      sseRef.current = fetchSSE<ChatPatch>(
        "/chat/send",
        { message: text, sessionId: ctx.state.sessionId, images },
        {
          onPatch: (patch) => {
            setTranscript((cur) => {
              const next = cur.slice();
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") return cur;
              next[next.length - 1] = { role: "assistant", patches: [...last.patches, patch] };
              if (patch.type === "slash-commands") ctx.setSlashCommands(patch.commands);
              return next;
            });
          },
          onDone: () => { ctx.setBusy(false); sseRef.current = null; },
          onError: (err) => {
            setTranscript((cur) => {
              const next = cur.slice();
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") return cur;
              next[next.length - 1] = {
                role: "assistant",
                patches: [...last.patches, { type: "error", message: err.message }, { type: "done" }],
              };
              return next;
            });
            ctx.setBusy(false);
            sseRef.current = null;
          },
        },
      );
    },
    [ctx],
  );

  const cancel = useCallback(() => {
    sseRef.current?.abort();
    sseRef.current = null;
    ctx.setBusy(false);
    if (ctx.state.sessionId) {
      void fetchJSON("/chat/cancel", { method: "POST", body: { sessionId: ctx.state.sessionId } });
    }
  }, [ctx]);

  const sendSteer = useCallback(async (text: string) => {
    if (!ctx.state.sessionId || !ctx.state.capabilities?.steer) return;
    setTranscript((cur) => [...cur, { role: "user", text: "(steer) " + text }]);
    await fetchJSON("/chat/steer", { method: "POST", body: { sessionId: ctx.state.sessionId, prompt: text } });
  }, [ctx]);

  const resolveApproval = useCallback(async (requestId: string, optionId: string) => {
    if (!ctx.state.sessionId) return;
    await fetchJSON("/chat/approval", { method: "POST", body: { sessionId: ctx.state.sessionId, requestId, optionId } });
  }, [ctx]);

  const startNewChat = useCallback(async () => {
    if (ctx.state.busy) cancel();
    setTranscript([]);
    await ctx.init(null);
    ctx.setTitle("New chat");
  }, [ctx, cancel]);

  const switchSession = useCallback(async (sessionId: string) => {
    if (ctx.state.busy) cancel();
    setTranscript([]);
    await ctx.init(sessionId);
  }, [ctx, cancel]);

  const forkCurrent = useCallback(async () => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ ok: boolean; sessionId: string }>(
      "/chat/sessions/fork",
      { method: "POST", body: { sessionId: ctx.state.sessionId } },
    );
    if (res.ok && res.data?.sessionId) await switchSession(res.data.sessionId);
  }, [ctx, switchSession]);

  const setModel = useCallback(async (modelId: string) => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ ok: boolean; current: string }>(
      "/chat/model",
      { method: "POST", body: { sessionId: ctx.state.sessionId, modelId } },
    );
    if (res.ok && res.data) ctx.setModels(ctx.state.models, res.data.current);
  }, [ctx]);

  const setAutoApprove = useCallback(async (enabled: boolean) => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ effective: boolean; default: boolean; override: boolean | null }>(
      "/chat/auto-approve",
      { method: "POST", body: { enabled, sessionId: ctx.state.sessionId } },
    );
    if (res.ok && res.data) {
      ctx.setAutoApprove({
        supported: true,
        default: res.data.default,
        override: res.data.override,
        effective: res.data.effective,
        enabled: res.data.effective,
      });
    }
  }, [ctx]);

  return {
    context: ctx,
    busy: ctx.state.busy,
    transcript,
    sendMessage,
    cancel,
    sendSteer,
    resolveApproval,
    startNewChat,
    switchSession,
    forkCurrent,
    setModel,
    setAutoApprove,
  };
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/state/useChat.test.tsx
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/state/useChat.ts frontend/src/state/useChat.test.tsx
git commit -m "feat(frontend): useChat hook — composes context + SSE + transcript"
```

---

## Phase C — Markdown component

### Task 11: Markdown component

**Files:**
- Create: `frontend/src/markdown.tsx`
- Create: `frontend/src/markdown.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/markdown.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./markdown";

describe("<Markdown>", () => {
  it("renders plain text", () => {
    const { container } = render(<Markdown source="hello world" />);
    expect(container.textContent).toBe("hello world");
  });

  it("renders bold and italic", () => {
    const { container } = render(<Markdown source="**bold** and *em*" />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("em");
  });

  it("renders a code block", () => {
    const md = "```\nlet x = 1;\n```";
    const { container } = render(<Markdown source={md} />);
    expect(container.querySelector("pre code")).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toContain("let x = 1;");
  });

  it("strips a <script> tag via rehype-sanitize", () => {
    const md = "before\n\n<script>alert(1)</script>\n\nafter";
    const { container } = render(<Markdown source={md} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/markdown.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/markdown.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export function Markdown({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
      {source}
    </ReactMarkdown>
  );
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/markdown.test.tsx
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/markdown.tsx frontend/src/markdown.test.tsx
git commit -m "feat(frontend): <Markdown> wrapper using react-markdown + sanitize"
```

---

## Phase D — Components

### Task 12: Sidenav

**Files:**
- Create: `frontend/src/components/Sidenav.tsx`
- Create: `frontend/src/components/Sidenav.module.css`
- Create: `frontend/src/components/Sidenav.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/Sidenav.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidenav } from "./Sidenav";

const noop = () => {};
describe("<Sidenav>", () => {
  it("renders the brand and tabs", () => {
    render(<Sidenav current="chat" onNavigate={noop} healthOk={null} />);
    expect(screen.getByText("Jarvis Bridge")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("marks the active tab", () => {
    render(<Sidenav current="status" onNavigate={noop} healthOk={null} />);
    const statusBtn = screen.getByText("Status").closest("button");
    expect(statusBtn?.className).toMatch(/active/);
  });

  it("calls onNavigate when a tab is clicked", () => {
    const onNav = vi.fn();
    render(<Sidenav current="chat" onNavigate={onNav} healthOk={null} />);
    fireEvent.click(screen.getByText("Status"));
    expect(onNav).toHaveBeenCalledWith("status");
  });

  it("shows ok health dot", () => {
    const { container } = render(<Sidenav current="chat" onNavigate={noop} healthOk={true} />);
    const dot = container.querySelector('[data-testid="health-dot"]');
    expect(dot?.className).toMatch(/ok/);
  });

  it("shows bad health dot", () => {
    const { container } = render(<Sidenav current="chat" onNavigate={noop} healthOk={false} />);
    const dot = container.querySelector('[data-testid="health-dot"]');
    expect(dot?.className).toMatch(/bad/);
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Sidenav.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/Sidenav.tsx`**

```tsx
import type { Route } from "../routes";
import styles from "./Sidenav.module.css";

export interface SidenavProps {
  current: Route;
  onNavigate: (r: Route) => void;
  healthOk: boolean | null;
}

export function Sidenav({ current, onNavigate, healthOk }: SidenavProps) {
  const dotClass =
    healthOk === null ? styles.dot
    : healthOk ? `${styles.dot} ${styles.ok}`
    : `${styles.dot} ${styles.bad}`;
  return (
    <aside className={styles.sidenav}>
      <div className={styles.brand}>
        <span data-testid="health-dot" className={dotClass} />
        <span>Jarvis Bridge</span>
      </div>
      <div className={styles.groupLabel}>Workspace</div>
      <NavBtn current={current} target="chat" onNavigate={onNavigate}>Chat</NavBtn>
      <div className={styles.groupLabel}>Admin</div>
      <NavBtn current={current} target="status" onNavigate={onNavigate}>Status</NavBtn>
      <NavBtn current={current} target="skills-manage" onNavigate={onNavigate}>Skills</NavBtn>
      <NavBtn current={current} target="settings" onNavigate={onNavigate}>Settings</NavBtn>
    </aside>
  );
}

function NavBtn({
  current, target, onNavigate, children,
}: {
  current: Route;
  target: Route;
  onNavigate: (r: Route) => void;
  children: React.ReactNode;
}) {
  const isActive = current === target;
  return (
    <button
      type="button"
      className={isActive ? `${styles.tab} ${styles.active}` : styles.tab}
      onClick={() => onNavigate(target)}
      data-tab={target}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/components/Sidenav.module.css`**

```css
.sidenav {
  width: var(--sidenav-w);
  flex-shrink: 0;
  background: var(--color-surface-1);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  padding: 12px 0;
}
.brand {
  padding: 4px 16px 12px;
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.dot.ok { background: var(--color-success); }
.dot.bad { background: var(--color-danger); }
.groupLabel {
  padding: 10px 16px 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}
.tab {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 6px 16px;
  font-size: 13px;
  color: var(--color-text);
}
.tab:hover { background: var(--color-surface-2); }
.tab.active {
  background: var(--color-accent-tint);
  color: var(--color-accent);
  font-weight: 600;
}
```

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Sidenav.test.tsx
```

Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/Sidenav.tsx frontend/src/components/Sidenav.module.css frontend/src/components/Sidenav.test.tsx
git commit -m "feat(frontend): <Sidenav> — brand + tabs + health dot"
```

---

### Task 13: HealthDot (polls /health/agent)

**Files:**
- Create: `frontend/src/components/HealthDot.tsx`
- Create: `frontend/src/components/HealthDot.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/HealthDot.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { HealthDot } from "./HealthDot";
import * as client from "../api/client";

describe("<HealthDot>", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("calls onUpdate(true) when /health/agent returns agent:true", async () => {
    vi.spyOn(client, "fetchJSON").mockResolvedValue({ ok: true, status: 200, data: { agent: true } });
    const onUpdate = vi.fn();
    render(<HealthDot onUpdate={onUpdate} />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(onUpdate).toHaveBeenCalledWith(true);
  });

  it("calls onUpdate(false) when agent is unreachable", async () => {
    vi.spyOn(client, "fetchJSON").mockResolvedValue({ ok: false, status: 500, data: null });
    const onUpdate = vi.fn();
    render(<HealthDot onUpdate={onUpdate} />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(onUpdate).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/HealthDot.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/HealthDot.tsx`**

```tsx
import { useEffect } from "react";
import { fetchJSON } from "../api/client";

export function HealthDot({ onUpdate }: { onUpdate: (ok: boolean) => void }) {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetchJSON<{ agent: boolean }>("/health/agent");
        if (cancelled) return;
        onUpdate(!!(res.data && res.data.agent));
      } catch {
        if (!cancelled) onUpdate(false);
      }
    };

    void poll();
    timer = setInterval(poll, 15000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [onUpdate]);

  return null;
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/HealthDot.test.tsx
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/HealthDot.tsx frontend/src/components/HealthDot.test.tsx
git commit -m "feat(frontend): <HealthDot> — polls /health/agent every 15s"
```

---

### Task 14: ApprovalModal

**Files:**
- Create: `frontend/src/components/ApprovalModal.tsx`
- Create: `frontend/src/components/ApprovalModal.module.css`
- Create: `frontend/src/components/ApprovalModal.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/ApprovalModal.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalModal } from "./ApprovalModal";

const basePatch = {
  type: "approval-request" as const,
  requestId: "r-1",
  toolCallId: "tc-1",
  toolName: "bash",
  options: [
    { id: "allow_once", name: "Allow once" },
    { id: "allow_always", name: "Always" },
  ],
};

describe("<ApprovalModal>", () => {
  it("renders nothing when not open", () => {
    const { container } = render(<ApprovalModal patch={null} onResolve={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the tool name and options", () => {
    render(<ApprovalModal patch={basePatch} onResolve={vi.fn()} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.getByText("Always")).toBeInTheDocument();
  });

  it("calls onResolve with the chosen optionId", () => {
    const onResolve = vi.fn();
    render(<ApprovalModal patch={basePatch} onResolve={onResolve} />);
    fireEvent.click(screen.getByText("Allow once"));
    expect(onResolve).toHaveBeenCalledWith("r-1", "allow_once");
  });

  it("offers a Deny button when no reject option is present", () => {
    render(<ApprovalModal patch={basePatch} onResolve={vi.fn()} />);
    expect(screen.getByText("Deny")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/ApprovalModal.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/ApprovalModal.tsx`**

```tsx
import type { ChatPatch } from "../api/types";
import styles from "./ApprovalModal.module.css";

interface ApprovalRequestPatch extends ChatPatch {
  type: "approval-request";
}

export function ApprovalModal({
  patch, onResolve,
}: {
  patch: ApprovalRequestPatch | null;
  onResolve: (requestId: string, optionId: string) => void;
}) {
  if (!patch) return null;
  const options = patch.options || [];
  const hasReject = options.some((o) =>
    /reject|deny|cancel/i.test(o.id || "") || /reject|deny|cancel/i.test(o.name || ""),
  );
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <header className={styles.header}><h2>Approve tool call</h2></header>
        <div className={styles.body}>
          <div>The agent wants to run:</div>
          <div><strong>{patch.toolName}</strong></div>
          <div className={styles.options}>
            {options.map((o) => (
              <button key={o.id} type="button" onClick={() => onResolve(patch.requestId, o.id)}>
                {o.name || o.id}
              </button>
            ))}
            {!hasReject && (
              <button type="button" className="danger" onClick={() => onResolve(patch.requestId, "reject")}>
                Deny
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/components/ApprovalModal.module.css`**

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  min-width: 360px;
  max-width: 600px;
  display: flex;
  flex-direction: column;
}
.header {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
}
.header h2 { margin: 0; font-size: 14px; }
.body { padding: 14px; }
.options {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.options button { text-align: left; }
```

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/ApprovalModal.test.tsx
```

Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/ApprovalModal.tsx frontend/src/components/ApprovalModal.module.css frontend/src/components/ApprovalModal.test.tsx
git commit -m "feat(frontend): <ApprovalModal> — surfaces tool approval"
```

---

### Task 15: InfoPanel

**Files:**
- Create: `frontend/src/components/InfoPanel.tsx`
- Create: `frontend/src/components/InfoPanel.module.css`
- Create: `frontend/src/components/InfoPanel.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/InfoPanel.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoPanel } from "./InfoPanel";
import type { ChatState } from "../state/ChatContext";

const baseState: ChatState = {
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  capabilities: {
    multipleSessions: true, customWorkingDirectory: true, cancel: true, steer: true,
    toolApprovals: true, slashCommands: true, canFork: true, images: true,
  },
  slashCommands: [{ name: "review" }],
  models: [{ modelId: "m1", name: "Model One" }],
  currentModel: "m1",
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  busy: false,
  title: "My chat",
  resumed: false,
};

const baseProps = {
  state: baseState, title: "My chat", group: "", pinned: false,
  onRename: vi.fn(), onGroup: vi.fn(), onPinned: vi.fn(),
  onModelChange: vi.fn(), onAutoApproveToggle: vi.fn(),
};

describe("<InfoPanel>", () => {
  it("renders session id, cwd, slash count, model", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ws")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Model One")).toBeInTheDocument();
  });

  it("calls onRename when title input changes", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} title="" onRename={onRename} />);
    fireEvent.change(screen.getByPlaceholderText("Untitled"), { target: { value: "new title" } });
    expect(onRename).toHaveBeenCalledWith("new title");
  });

  it("calls onAutoApproveToggle when the toggle is clicked", () => {
    const onToggle = vi.fn();
    render(<InfoPanel {...baseProps} onAutoApproveToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("auto-approve-toggle"));
    expect(onToggle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/InfoPanel.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/InfoPanel.tsx`**

```tsx
import type { ChatState } from "../state/ChatContext";
import styles from "./InfoPanel.module.css";

export interface InfoPanelProps {
  state: ChatState;
  title: string;
  group: string;
  pinned: boolean;
  onRename: (t: string) => void;
  onGroup: (g: string) => void;
  onPinned: (p: boolean) => void;
  onModelChange: (modelId: string) => void;
  onAutoApproveToggle: () => void;
}

export function InfoPanel(props: InfoPanelProps) {
  const { state, title, group, pinned, onRename, onGroup, onPinned, onModelChange, onAutoApproveToggle } = props;
  return (
    <aside className={styles.panel}>
      <div className={styles.card}>
        <h3>Current chat</h3>
        <div className={styles.row}>
          <span className={styles.key}>Title</span>
          <input placeholder="Untitled" value={title} onChange={(e) => onRename(e.target.value)} />
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Group</span>
          <input value={group} onChange={(e) => onGroup(e.target.value)} />
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Pinned</span>
          <input type="checkbox" checked={pinned} onChange={(e) => onPinned(e.target.checked)} />
        </div>
      </div>

      <div className={styles.card}>
        <h3>Overview</h3>
        <div className={styles.row}>
          <span className={styles.key}>Workspace</span>
          <span className={styles.val}>{state.cwd ?? "—"}</span>
        </div>
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
      </div>

      <div className={styles.card}>
        <h3>Session</h3>
        <div className={styles.row}>
          <span className={styles.key}>ID</span>
          <span className={styles.val}>{state.sessionId ?? "—"}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Slash cmds</span>
          <span className={styles.val}>{state.slashCommands.length}</span>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/components/InfoPanel.module.css`**

```css
.panel {
  background: var(--color-surface-1);
  overflow-y: auto;
  padding: 12px;
}
.card {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px;
  margin-bottom: 10px;
}
.card h3 {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin: 4px 0;
}
.key { color: var(--color-text-muted); }
.val {
  font-family: var(--font-mono);
  word-break: break-all;
  text-align: right;
}
```

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/InfoPanel.test.tsx
```

Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/InfoPanel.tsx frontend/src/components/InfoPanel.module.css frontend/src/components/InfoPanel.test.tsx
git commit -m "feat(frontend): <InfoPanel> — title/group/pinned/model/auto-approve"
```

---

### Task 16: PastChatsMenu

**Files:**
- Create: `frontend/src/components/PastChatsMenu.tsx`
- Create: `frontend/src/components/PastChatsMenu.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/PastChatsMenu.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PastChatsMenu } from "./PastChatsMenu";

describe("<PastChatsMenu>", () => {
  it("renders empty state when no sessions", () => {
    render(<PastChatsMenu open={true} sessions={[]} onClose={vi.fn()} onSwitch={vi.fn()} />);
    expect(screen.getByText(/no past chats/i)).toBeInTheDocument();
  });

  it("renders each session and calls onSwitch when clicked", () => {
    const onSwitch = vi.fn();
    render(
      <PastChatsMenu
        open={true}
        sessions={[
          { sessionId: "s1", title: "first", customTitle: "alpha" },
          { sessionId: "s2", title: "second" },
        ]}
        onClose={vi.fn()}
        onSwitch={onSwitch}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    fireEvent.click(screen.getByText("second"));
    expect(onSwitch).toHaveBeenCalledWith("s2");
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PastChatsMenu open={false} sessions={[]} onClose={vi.fn()} onSwitch={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/PastChatsMenu.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/PastChatsMenu.tsx`**

```tsx
import type { SessionSummary } from "../api/types";

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
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--color-surface-1)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)", minWidth: 360, maxHeight: "70vh",
        overflowY: "auto", padding: 14,
      }}>
        <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>Chats</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {sessions.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)" }}>(no past chats yet)</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.sessionId} style={{ padding: "4px 0", cursor: "pointer", color: "var(--color-accent)" }}
                  onClick={() => onSwitch(s.sessionId)}>
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

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/PastChatsMenu.test.tsx
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/PastChatsMenu.tsx frontend/src/components/PastChatsMenu.test.tsx
git commit -m "feat(frontend): <PastChatsMenu> — sessions list + switch"
```

---

## Phase E — ChatPanel + Timeline + Composer

### Task 17: Timeline (the big patch renderer)

**Files:**
- Create: `frontend/src/components/Timeline.tsx`
- Create: `frontend/src/components/Timeline.module.css`
- Create: `frontend/src/components/Timeline.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/Timeline.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Timeline } from "./Timeline";
import type { ChatPatch } from "../api/types";

describe("<Timeline>", () => {
  it("renders text-start as a markdown bubble", () => {
    const { container } = render(
      <Timeline patches={[
        { type: "text-start", index: 0, content: "hello" },
        { type: "text-delta", index: 0, delta: " world" },
      ]} />,
    );
    expect(container.textContent).toContain("hello world");
  });

  it("renders a tool call card with args and return", () => {
    const { container } = render(
      <Timeline patches={[
        { type: "tool-call-start", index: 0, toolCallId: "tc-1", toolName: "bash", argsInitial: "" },
        { type: "tool-call-finalized", index: 0, toolCallId: "tc-1", args: { command: "ls" } },
        { type: "tool-return", toolCallId: "tc-1", content: "file.txt\n" },
      ]} />,
    );
    expect(container.textContent).toContain("bash");
    expect(container.textContent).toContain("ls");
    expect(container.textContent).toContain("file.txt");
  });

  it("renders a thought block", () => {
    const { container } = render(<Timeline patches={[{ type: "thought-start", index: 0, content: "thinking…" }]} />);
    expect(container.textContent).toContain("thinking…");
  });

  it("renders an error", () => {
    const { container } = render(<Timeline patches={[{ type: "error", message: "boom" }]} />);
    expect(container.textContent).toContain("boom");
  });

  it("renders usage as token pills", () => {
    const { container } = render(
      <Timeline patches={[{
        type: "usage",
        usage: { requests: 1, input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 },
      }]} />,
    );
    expect(container.textContent).toMatch(/in\s+10/);
    expect(container.textContent).toMatch(/out\s+20/);
  });

  it("emits approval-request via callback", () => {
    let received: ChatPatch | null = null;
    render(
      <Timeline
        patches={[{
          type: "approval-request",
          requestId: "r1",
          toolCallId: "tc-1",
          toolName: "bash",
          options: [{ id: "allow_once", name: "Allow once" }],
        }]}
        onApproval={(p) => (received = p)}
      />,
    );
    expect(received).not.toBeNull();
    expect((received as ChatPatch & { requestId: string }).requestId).toBe("r1");
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Timeline.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/Timeline.tsx`**

```tsx
import { useMemo } from "react";
import { Markdown } from "../markdown";
import type { ChatPatch, UsageTotals } from "../api/types";
import styles from "./Timeline.module.css";

export interface TimelineProps {
  patches: ChatPatch[];
  onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
  onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
}

type Bubble =
  | { kind: "text"; content: string }
  | { kind: "thought"; content: string }
  | { kind: "tool"; toolName: string; argsText: string; result?: { ok: boolean; text: string } };

interface TimelineState {
  bubbles: Bubble[];
  usage?: UsageTotals;
  error?: string;
}

function buildTimelineState(
  patches: ChatPatch[],
  emit: {
    onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
    onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
    onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
  },
): TimelineState {
  const bubbles: Bubble[] = [];
  let usage: UsageTotals | undefined;
  let error: string | undefined;
  let currentText: string | null = null;
  const toolsByCallId = new Map<string, number>();

  for (const p of patches) {
    switch (p.type) {
      case "text-start":
        currentText = p.content || "";
        bubbles.push({ kind: "text", content: currentText });
        break;
      case "text-delta":
        if (currentText !== null) {
          currentText += p.delta || "";
          const last = bubbles[bubbles.length - 1];
          if (last && last.kind === "text") last.content = currentText;
        } else {
          currentText = p.delta || "";
          bubbles.push({ kind: "text", content: currentText });
        }
        break;
      case "thought-start":
        bubbles.push({ kind: "thought", content: p.content || "" });
        break;
      case "thought-delta": {
        const last = bubbles[bubbles.length - 1];
        if (last && last.kind === "thought") last.content += p.delta || "";
        else bubbles.push({ kind: "thought", content: p.delta || "" });
        break;
      }
      case "tool-call-start": {
        const args = p.argsInitial || "";
        bubbles.push({ kind: "tool", toolName: p.toolName, argsText: args });
        if (p.toolCallId) toolsByCallId.set(p.toolCallId, bubbles.length - 1);
        currentText = null;
        break;
      }
      case "tool-call-finalized": {
        const idx = p.toolCallId ? toolsByCallId.get(p.toolCallId) : undefined;
        const target = idx !== undefined ? bubbles[idx] : bubbles[bubbles.length - 1];
        if (target && target.kind === "tool") {
          target.argsText = p.args !== undefined
            ? JSON.stringify(p.args, null, 2)
            : (p.argsRaw ?? target.argsText);
          if (p.intent) target.toolName = p.intent;
        }
        break;
      }
      case "tool-return":
      case "tool-error": {
        const idx = p.toolCallId ? toolsByCallId.get(p.toolCallId) : undefined;
        const target = idx !== undefined ? bubbles[idx] : bubbles[bubbles.length - 1];
        if (target && target.kind === "tool") {
          target.result = {
            ok: p.type === "tool-return",
            text: typeof p.content === "string" ? p.content : JSON.stringify(p.content, null, 2),
          };
        }
        break;
      }
      case "tool-return-orphan":
        bubbles.push({
          kind: "tool",
          toolName: p.toolName || "return",
          argsText: "",
          result: {
            ok: true,
            text: typeof p.content === "string" ? p.content : JSON.stringify(p.content, null, 2),
          },
        });
        break;
      case "usage":
        usage = p.usage;
        break;
      case "error":
        error = p.message;
        break;
      case "approval-request":
        emit.onApproval?.(p);
        break;
      case "steer-ack":
        emit.onSteerAck?.(p);
        break;
      case "images-skipped":
        emit.onImagesSkipped?.(p);
        break;
      default:
        break;
    }
  }
  return { bubbles, usage, error };
}

function renderBubble(b: Bubble, key: number): JSX.Element {
  switch (b.kind) {
    case "text":
      return <div key={key} className={styles.text}><Markdown source={b.content} /></div>;
    case "thought":
      return (
        <details key={key} className={styles.thought} open>
          <summary>Thinking…</summary>
          <div>{b.content}</div>
        </details>
      );
    case "tool":
      return (
        <details key={key} className={b.result && !b.result.ok ? `${styles.tool} ${styles.toolError}` : styles.tool} open>
          <summary>{b.toolName}</summary>
          {b.argsText && <pre className={styles.toolArgs}>{b.argsText}</pre>}
          {b.result && (
            <div className={styles.toolResult}>
              <span className={b.result.ok ? styles.ok : styles.err}>{b.result.ok ? "ok" : "error"}</span>{" "}
              {b.result.text}
            </div>
          )}
        </details>
      );
  }
}

function usagePills(u: UsageTotals): string[] {
  const out: string[] = [];
  if (u.input_tokens) out.push("in " + u.input_tokens);
  if (u.output_tokens) out.push("out " + u.output_tokens);
  if (u.thought_tokens) out.push("think " + u.thought_tokens);
  if (u.cache_read_tokens) out.push("cache " + u.cache_read_tokens);
  return out;
}

export function Timeline({ patches, onApproval, onSteerAck, onImagesSkipped }: TimelineProps) {
  const state = useMemo(
    () => buildTimelineState(patches, { onApproval, onSteerAck, onImagesSkipped }),
    [patches, onApproval, onSteerAck, onImagesSkipped],
  );
  return (
    <div className={styles.timeline}>
      {state.bubbles.map((b, i) => renderBubble(b, i))}
      {state.usage && (
        <div className={styles.usage}>
          {usagePills(state.usage).map((s, i) => <span key={i}>{s}</span>)}
        </div>
      )}
      {state.error && <div className={styles.errorMsg}>{state.error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/components/Timeline.module.css`**

```css
.timeline { display: flex; flex-direction: column; gap: 8px; }
.text { word-wrap: break-word; }
.thought {
  font-style: italic;
  color: var(--color-text-muted);
  border-left: 2px solid var(--color-border);
  padding-left: 10px;
}
.thought summary { cursor: pointer; user-select: none; font-weight: 600; }
.tool {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 13px;
}
.tool summary { cursor: pointer; user-select: none; font-weight: 600; }
.toolArgs {
  margin: 4px 0 0;
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
.ok { color: var(--color-success); }
.err { color: var(--color-danger); }
.usage {
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
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

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Timeline.test.tsx
```

Expected: PASS (6/6).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/Timeline.tsx frontend/src/components/Timeline.module.css frontend/src/components/Timeline.test.tsx
git commit -m "feat(frontend): <Timeline> — patch→DOM renderer (shared live + replay)"
```

---

### Task 18: Composer

**Files:**
- Create: `frontend/src/components/Composer.tsx`
- Create: `frontend/src/components/Composer.module.css`
- Create: `frontend/src/components/Composer.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/Composer.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";
import type { ImageAttachment } from "../api/types";

const noopAsync = async () => {};

const baseProps = {
  busy: false,
  steerEnabled: false,
  steerSupported: true,
  imagesSupported: true,
  attachments: [] as ImageAttachment[],
  onRemoveAttachment: vi.fn(),
  onAttachFiles: vi.fn(),
  onSend: vi.fn(),
  onSteer: noopAsync,
  onCancel: noopAsync,
  onQueue: noopAsync,
  onToggleSteer: vi.fn(),
};

describe("<Composer>", () => {
  it("submits with the trimmed text", () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(textarea, { target: { value: "  hi  " } });
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("shows the cancel button while busy", () => {
    render(<Composer {...baseProps} busy={true} />);
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("calls onCancel when stop is clicked", () => {
    const onCancel = vi.fn();
    render(<Composer {...baseProps} busy={true} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Stop"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders image attachments with remove buttons", () => {
    const onRemove = vi.fn();
    const attachments: ImageAttachment[] = [{ data: "abc", mimeType: "image/png", filename: "a.png" }];
    render(<Composer {...baseProps} attachments={attachments} onRemoveAttachment={onRemove} />);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    fireEvent.click(screen.getByText("×"));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Composer.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/Composer.tsx`**

```tsx
import { useRef, useState, type FormEvent } from "react";
import type { ImageAttachment } from "../api/types";
import styles from "./Composer.module.css";

export interface ComposerProps {
  busy: boolean;
  steerEnabled: boolean;
  steerSupported: boolean;
  imagesSupported: boolean;
  attachments: ImageAttachment[];
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
    attachments, onRemoveAttachment, onAttachFiles,
    onSend, onSteer, onCancel, onQueue, onToggleSteer,
  } = props;
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = (ev?: FormEvent) => {
    if (ev) ev.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (steerEnabled) void onSteer(trimmed);
    else if (busy) void onQueue(trimmed);
    else onSend(trimmed);
    setText("");
  };

  return (
    <form className={styles.form} onSubmit={submit} autoComplete="off">
      <div className={styles.attachments}>
        {attachments.map((img, idx) => (
          <div key={idx} className={styles.attachment}>
            <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.filename || "image"} />
            <span>{img.filename || `image ${idx + 1}`}</span>
            <button type="button" onClick={() => onRemoveAttachment(idx)} aria-label="remove">×</button>
          </div>
        ))}
      </div>
      <div className={styles.row}>
        <textarea
          rows={2}
          placeholder={steerEnabled ? "Steer the running turn…" : "Type a message… (Shift+Enter for newline, Enter to send)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy && !steerEnabled}
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
        <div className={styles.actions}>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!imagesSupported} title="Attach image">📎</button>
          {busy ? (
            <button type="button" className="danger" onClick={() => void onCancel()}>Stop</button>
          ) : (
            <button type="submit" className="primary">Send</button>
          )}
          {busy && <button type="button" onClick={() => void onQueue(text)} disabled={!text.trim()}>Queue</button>}
          {steerSupported && (
            <button type="button" className={steerEnabled ? "primary" : ""} onClick={onToggleSteer}>Steer</button>
          )}
        </div>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/components/Composer.module.css`**

```css
.form {
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-1);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
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
  font-size: 12px;
}
.attachment img {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 2px;
}
.row { display: flex; gap: 8px; align-items: flex-end; }
.row textarea { flex: 1; min-height: 40px; max-height: 200px; }
.actions { display: flex; flex-direction: column; gap: 4px; }
.actions button { padding: 6px 12px; min-width: 80px; }
```

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Composer.test.tsx
```

Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/Composer.tsx frontend/src/components/Composer.module.css frontend/src/components/Composer.test.tsx
git commit -m "feat(frontend): <Composer> — textarea + attachments + send/cancel/steer"
```

---

### Task 19: Message + Transcript

**Files:**
- Create: `frontend/src/components/Message.tsx`
- Create: `frontend/src/components/Message.module.css`
- Create: `frontend/src/components/Message.test.tsx`
- Create: `frontend/src/components/Transcript.tsx`
- Create: `frontend/src/components/Transcript.module.css`
- Create: `frontend/src/components/Transcript.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/Message.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Message } from "./Message";

describe("<Message>", () => {
  it("renders user text + images", () => {
    const { container } = render(
      <Message entry={{ role: "user", text: "hi", images: [{ data: "abc", mimeType: "image/png", filename: "a.png" }] }} />,
    );
    expect(container.textContent).toContain("hi");
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("renders an assistant timeline from patches", () => {
    const { container } = render(
      <Message entry={{ role: "assistant", patches: [{ type: "text-start", index: 0, content: "ok" }] }} />,
    );
    expect(container.textContent).toContain("ok");
  });

  it("applies the error class when an error patch is present", () => {
    const { container } = render(
      <Message
        entry={{
          role: "assistant",
          patches: [
            { type: "text-start", index: 0, content: "" },
            { type: "error", message: "boom" },
          ],
        }}
      />,
    );
    expect(container.firstElementChild?.className).toMatch(/error/);
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Message.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/Message.tsx`**

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
        <div className={styles.role}>You</div>
        <div className={styles.bubble}>
          {entry.text && <div>{entry.text}</div>}
          {entry.images && entry.images.length > 0 && (
            <div className={styles.attachments}>
              {entry.images.map((img, idx) => (
                <img key={idx} src={`data:${img.mimeType};base64,${img.data}`} alt={img.filename || "image"} title={img.filename} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  const hasError = entry.patches.some((p) => p.type === "error");
  return (
    <div className={`${styles.message} ${styles.assistant} ${hasError ? styles.error : ""}`}>
      <div className={styles.role}>Assistant</div>
      <div className={styles.bubble}>
        <Timeline patches={entry.patches} onApproval={onApproval} onSteerAck={onSteerAck} onImagesSkipped={onImagesSkipped} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/components/Message.module.css`**

```css
.message { display: flex; flex-direction: column; gap: 6px; }
.user { align-items: flex-end; }
.role {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}
.bubble {
  max-width: 80%;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  word-wrap: break-word;
}
.user .bubble {
  background: var(--color-accent-tint);
  border-color: var(--color-accent);
}
.error .bubble { border-color: var(--color-danger); color: var(--color-danger); }
.attachments { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.attachments img {
  max-width: 120px;
  max-height: 120px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}
```

- [ ] **Step 5: Run Message test (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Message.test.tsx
```

Expected: PASS (3/3).

- [ ] **Step 6: Write failing Transcript test `frontend/src/components/Transcript.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript } from "./Transcript";

describe("<Transcript>", () => {
  it("renders the empty state when no messages", () => {
    render(<Transcript entries={[]} onApproval={vi.fn()} onSteerAck={vi.fn()} onImagesSkipped={vi.fn()} />);
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });

  it("renders one Message per entry", () => {
    render(
      <Transcript
        entries={[
          { role: "user", text: "hi" },
          { role: "assistant", patches: [{ type: "text-start", index: 0, content: "hello" }] },
        ]}
        onApproval={vi.fn()}
        onSteerAck={vi.fn()}
        onImagesSkipped={vi.fn()}
      />,
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Implement `frontend/src/components/Transcript.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { Message, type MessageEntry } from "./Message";
import type { ChatPatch } from "../api/types";
import styles from "./Transcript.module.css";

export interface TranscriptProps {
  entries: MessageEntry[];
  onApproval: (p: ChatPatch & { type: "approval-request" }) => void;
  onSteerAck: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped: (p: ChatPatch & { type: "images-skipped" }) => void;
}

export function Transcript(props: TranscriptProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [props.entries]);
  if (props.entries.length === 0) {
    return (
      <div ref={ref} className={styles.transcript}>
        <div className={styles.empty}>
          <h2>Start a conversation</h2>
          <p>Send a message to begin.</p>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className={styles.transcript} role="log" aria-live="polite">
      {props.entries.map((entry, idx) => (
        <Message
          key={idx}
          entry={entry}
          onApproval={props.onApproval}
          onSteerAck={props.onSteerAck}
          onImagesSkipped={props.onImagesSkipped}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Implement `frontend/src/components/Transcript.module.css`**

```css
.transcript {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.empty { margin: auto; text-align: center; color: var(--color-text-muted); }
```

- [ ] **Step 9: Run Transcript test (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/Transcript.test.tsx
```

Expected: PASS (2/2).

- [ ] **Step 10: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/Message.tsx frontend/src/components/Message.module.css frontend/src/components/Message.test.tsx \
        frontend/src/components/Transcript.tsx frontend/src/components/Transcript.module.css frontend/src/components/Transcript.test.tsx
git commit -m "feat(frontend): <Message> + <Transcript> — user/assistant bubbles"
```

---

### Task 20: ChatPanel — composes everything

**Files:**
- Create: `frontend/src/components/ChatPanel.tsx`
- Create: `frontend/src/components/ChatPanel.module.css`
- Create: `frontend/src/components/ChatPanel.test.tsx`

- [ ] **Step 1: Write failing test `frontend/src/components/ChatPanel.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";

describe("<ChatPanel>", () => {
  it("renders the title, info toggle, and composer", () => {
    render(<ChatPanel />);
    expect(screen.getByText("New chat")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("renders the empty transcript state", () => {
    render(<ChatPanel />);
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/ChatPanel.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/components/ChatPanel.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatProvider, useChatContext } from "../state/ChatContext";
import { useChat } from "../state/useChat";
import { useToast } from "../state/ToastContext";
import { fetchJSON } from "../api/client";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { InfoPanel } from "./InfoPanel";
import { ApprovalModal } from "./ApprovalModal";
import { PastChatsMenu } from "./PastChatsMenu";
import type { ImageAttachment, SessionSummary, ChatPatch } from "../api/types";
import styles from "./ChatPanel.module.css";

export function ChatPanel() {
  return (
    <ChatProvider>
      <ChatPanelInner />
    </ChatProvider>
  );
}

function ChatPanelInner() {
  const chat = useChat();
  const toast = useToast();
  const ctx = chat.context;
  const [infoHidden, setInfoHidden] = useState(false);
  const [pastChatsOpen, setPastChatsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [steerEnabled, setSteerEnabled] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ChatPatch | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [group, setGroup] = useState("");
  const [pinned, setPinned] = useState(false);
  const queueRef = useRef<string | null>(null);

  // Publish cwd to a window event so the App-level TerminalDrawer can show it.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("jarvis:cwd-changed", { detail: { cwd: ctx.state.cwd } }),
    );
  }, [ctx.state.cwd]);

  const onApproval = useCallback((p: ChatPatch & { type: "approval-request" }) => {
    setPendingApproval(p);
  }, []);

  const onResolveApproval = useCallback(
    async (requestId: string, optionId: string) => {
      setPendingApproval(null);
      try {
        await chat.resolveApproval(requestId, optionId);
      } catch (err) {
        toast.push("Approval failed: " + (err instanceof Error ? err.message : String(err)), "error");
      }
    },
    [chat, toast],
  );

  const onSteerAck = useCallback(
    (p: ChatPatch & { type: "steer-ack" }) => {
      toast.push(p.accepted ? "Steer accepted" : "Steer rejected: " + (p.reason || ""), p.accepted ? "success" : "warning");
    },
    [toast],
  );

  const onImagesSkipped = useCallback(
    (p: ChatPatch & { type: "images-skipped" }) => {
      toast.push("Skipped " + (p.skipped || []).length + " image(s)", "warning");
    },
    [toast],
  );

  const onSend = useCallback(
    (text: string) => {
      const imgs = attachments;
      setAttachments([]);
      void chat.sendMessage(text, imgs);
    },
    [attachments, chat],
  );

  const onAttachFiles = useCallback((files: File[]) => {
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result || "");
        const base64 = data.split(",")[1] || "";
        setAttachments((cur) => [...cur, { data: base64, mimeType: file.type, filename: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const onRemoveAttachment = useCallback((idx: number) => {
    setAttachments((cur) => cur.filter((_, i) => i !== idx));
  }, []);

  const onRename = useCallback(
    (t: string) => {
      ctx.setTitle(t || "Untitled");
      if (ctx.state.sessionId) {
        void fetchJSON(`/chat/sessions/${encodeURIComponent(ctx.state.sessionId)}`, {
          method: "PATCH",
          body: { customTitle: t || null },
        });
      }
    },
    [ctx],
  );

  const onGroupChange = useCallback(
    (g: string) => {
      setGroup(g);
      if (ctx.state.sessionId) {
        void fetchJSON(`/chat/sessions/${encodeURIComponent(ctx.state.sessionId)}`, {
          method: "PATCH",
          body: { group: g || null },
        });
      }
    },
    [ctx],
  );

  const onPinnedChange = useCallback(
    (p: boolean) => {
      setPinned(p);
      if (ctx.state.sessionId) {
        void fetchJSON(`/chat/sessions/${encodeURIComponent(ctx.state.sessionId)}`, {
          method: "PATCH",
          body: { pinned: p },
        });
      }
    },
    [ctx],
  );

  const onModelChange = useCallback(
    (modelId: string) => {
      void chat.setModel(modelId);
    },
    [chat],
  );

  const onAutoApproveToggle = useCallback(() => {
    void chat.setAutoApprove(!ctx.state.autoApprove.effective);
  }, [chat, ctx]);

  const onQueue = useCallback(async (text: string) => {
    queueRef.current = text;
    toast.push("Queued for after current turn", "info");
  }, [toast]);

  const onSteerComposer = useCallback(async (text: string) => {
    await chat.sendSteer(text);
  }, [chat]);

  // After a turn ends, drain the queue.
  useEffect(() => {
    if (!chat.busy && queueRef.current) {
      const next = queueRef.current;
      queueRef.current = null;
      setAttachments([]);
      void chat.sendMessage(next);
    }
  }, [chat.busy, chat]);

  const openPastChats = useCallback(async () => {
    const res = await fetchJSON<{ sessions: SessionSummary[] }>("/chat/sessions");
    if (res.ok && res.data) setSessions(res.data.sessions);
    setPastChatsOpen(true);
  }, []);

  const onSwitchSession = useCallback(
    async (sessionId: string) => {
      setPastChatsOpen(false);
      await chat.switchSession(sessionId);
    },
    [chat],
  );

  const onForkCurrent = useCallback(() => {
    void chat.forkCurrent().then(() => toast.push("Forked new session", "success"));
  }, [chat, toast]);

  const onNewChat = useCallback(async () => {
    await chat.startNewChat();
  }, [chat]);

  return (
    <div className={styles.panel}>
      <div className={styles.stage}>
        <div className={styles.main}>
          <div className={styles.header}>
            <h1>{ctx.state.title || "New chat"}</h1>
            <button onClick={() => setInfoHidden((v) => !v)}>Info</button>
            <button onClick={openPastChats}>Chats</button>
            <button onClick={onNewChat}>+ New</button>
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
          <PastChatsMenu open={pastChatsOpen} sessions={sessions} onClose={() => setPastChatsOpen(false)} onSwitch={onSwitchSession} />
          <Transcript entries={chat.transcript} onApproval={onApproval} onSteerAck={onSteerAck} onImagesSkipped={onImagesSkipped} />
          <Composer
            busy={chat.busy}
            steerEnabled={steerEnabled}
            steerSupported={!!ctx.state.capabilities?.steer}
            imagesSupported={!!ctx.state.capabilities?.images}
            attachments={attachments}
            onRemoveAttachment={onRemoveAttachment}
            onAttachFiles={onAttachFiles}
            onSend={onSend}
            onSteer={onSteerComposer}
            onCancel={async () => chat.cancel()}
            onQueue={onQueue}
            onToggleSteer={() => setSteerEnabled((v) => !v)}
          />
        </div>
        <InfoPanel
          state={ctx.state}
          title={ctx.state.title}
          group={group}
          pinned={pinned}
          onRename={onRename}
          onGroup={onGroupChange}
          onPinned={onPinnedChange}
          onModelChange={onModelChange}
          onAutoApproveToggle={onAutoApproveToggle}
          {...(infoHidden ? { hidden: true } : {})}
        />
      </div>
      <ApprovalModal patch={pendingApproval} onResolve={onResolveApproval} />
    </div>
  );
}
```

Wait — the InfoPanel takes a `hidden` prop? No, it doesn't. I added an extra spread accidentally. Let me fix:

The InfoPanel signature in Task 15 doesn't have a `hidden` prop. Apply hidden via the CSS class on the wrapper. Replace the spread with proper handling:

```tsx
<InfoPanel ... />
```

wrap with hidden class:

```tsx
<div className={infoHidden ? styles.infoHidden : undefined}>
  <InfoPanel ... />
</div>
```

- [ ] **Step 3 (CORRECTED): Replace the `<InfoPanel>` JSX in ChatPanel with a wrapper that toggles the `hidden` CSS class**

Edit ChatPanel.tsx, find:

```tsx
<InfoPanel
  state={ctx.state}
  title={ctx.state.title}
  ...
/>
```

Replace with:

```tsx
<div className={infoHidden ? styles.infoHidden : ""}>
  <InfoPanel
    state={ctx.state}
    title={ctx.state.title}
    group={group}
    pinned={pinned}
    onRename={onRename}
    onGroup={onGroupChange}
    onPinned={onPinnedChange}
    onModelChange={onModelChange}
    onAutoApproveToggle={onAutoApproveToggle}
  />
</div>
```

- [ ] **Step 4: Implement `frontend/src/components/ChatPanel.module.css`**

```css
.panel { display: flex; flex: 1; flex-direction: column; overflow: hidden; }
.stage { display: grid; grid-template-columns: 1fr 280px; flex: 1; overflow: hidden; }
.main { display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--color-border); }
.infoHidden { display: none; }
.header {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  height: var(--header-h); border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-1); flex-shrink: 0;
}
.header h1 {
  margin: 0; font-size: 13px; font-weight: 600; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.header button { padding: 4px 8px; font-size: 12px; }
```

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vitest run src/components/ChatPanel.test.tsx
```

Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/ChatPanel.tsx frontend/src/components/ChatPanel.module.css frontend/src/components/ChatPanel.test.tsx
git commit -m "feat(frontend): <ChatPanel> — composes Transcript + Composer + InfoPanel + modals"
```

---

## Phase F — Other panels + skill iframe

### Task 21: StatusPanel + SettingsPanel + SkillsManagePanel + SkillPanel + TerminalDrawer

**Files:**
- Create: `frontend/src/components/StatusPanel.tsx`
- Create: `frontend/src/components/SettingsPanel.tsx`
- Create: `frontend/src/components/SkillsManagePanel.tsx`
- Create: `frontend/src/components/SkillPanel.tsx`
- Create: `frontend/src/components/TerminalDrawer.tsx`

- [ ] **Step 1: Create `frontend/src/components/StatusPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { fetchJSON } from "../api/client";

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
    <div style={{ padding: 16 }}>
      <h2>Status</h2>
      {data ? (
        <div>
          <div>Busy: {data.busy ? "yes" : "no"}</div>
          <div>Active chat streams: {data.chat.activeCount}</div>
        </div>
      ) : (
        <div style={{ color: "var(--color-text-muted)" }}>(status unavailable)</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/SettingsPanel.tsx`**

```tsx
import { useEffect, useState } from "react";

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
    <div style={{ padding: 16 }}>
      <h2>Settings</h2>
      <h3>Quick phrases</h3>
      <p style={{ color: "var(--color-text-muted)" }}>Click to insert into the composer. Saved locally.</p>
      <ul>
        {phrases.map((p, idx) => (
          <li key={idx}>
            {p} <button onClick={() => remove(idx)}>remove</button>
          </li>
        ))}
      </ul>
      <div>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New quick phrase…" />
        <button onClick={add}>Add</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/components/SkillsManagePanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { fetchJSON } from "../api/client";

interface Skill { name: string; hasUi: boolean; displayName?: string; description?: string; icon?: string; }

export function SkillsManagePanel() {
  const [installed, setInstalled] = useState<Skill[]>([]);
  const [initial, setInitial] = useState<Skill[]>([]);
  useEffect(() => {
    void fetchJSON<{ skills: Skill[] }>("/skills").then((r) => r.ok && setInstalled(r.data!.skills));
    void fetchJSON<{ skills: Skill[] }>("/skills/initial").then((r) => r.ok && setInitial(r.data!.skills));
  }, []);
  return (
    <div style={{ padding: 16 }}>
      <h2>Skills</h2>
      <h3>Installed</h3>
      {installed.length === 0 ? <div style={{ color: "var(--color-text-muted)" }}>(none)</div> : (
        <ul>{installed.map((s) => <li key={s.name}>{s.name}{s.hasUi ? " [ui]" : ""}</li>)}</ul>
      )}
      <h3>Template</h3>
      {initial.length === 0 ? <div style={{ color: "var(--color-text-muted)" }}>(none)</div> : (
        <ul>{initial.map((s) => <li key={s.name}>{s.name}{s.hasUi ? " [ui]" : ""}</li>)}</ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `frontend/src/components/SkillPanel.tsx`**

```tsx
export function SkillPanel({ name }: { name: string }) {
  return (
    <iframe
      title={`skill-${name}`}
      src={`/skills/${encodeURIComponent(name)}/ui/`}
      style={{ width: "100%", height: "100%", border: "none", background: "white" }}
    />
  );
}
```

- [ ] **Step 5: Create `frontend/src/components/TerminalDrawer.tsx`**

```tsx
import { useEffect, useState } from "react";

export function TerminalDrawer({ cwd }: { cwd: string | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "`" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        setOpen((v) => !v);
      } else if (ev.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Expose a global toggle for the chat header button.
  useEffect(() => {
    (window as { JarvisTerminal?: { toggle: () => void } }).JarvisTerminal = {
      toggle: () => setOpen((v) => !v),
    };
    return () => { delete (window as { JarvisTerminal?: unknown }).JarvisTerminal; };
  }, []);

  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", right: 0, bottom: 0, width: 600, maxWidth: "80vw",
        height: 320, background: "#000", border: "1px solid var(--color-border)",
        borderRight: "none", borderBottom: "none",
        borderTopLeftRadius: "var(--radius-md)",
        display: "flex", flexDirection: "column", zIndex: 80,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", padding: "4px 8px", background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-border)", fontSize: 12, gap: 8 }}>
        <span>Terminal</span>
        <span style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>{cwd || "—"}</span>
        <button onClick={() => setOpen(false)}>×</button>
      </header>
      <pre style={{ flex: 1, margin: 0, padding: "6px 8px", background: "#000", color: "#d8f5ff", fontFamily: "var(--font-mono)", fontSize: 12, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        [terminal not yet wired — backend /terminal WebSocket is not implemented]
      </pre>
      <input style={{ width: "100%", background: "#001020", color: "#d8f5ff", border: "none", borderTop: "1px solid var(--color-border)", padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 12 }} placeholder="(terminal WS not yet wired)" disabled />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/components/StatusPanel.tsx frontend/src/components/SettingsPanel.tsx frontend/src/components/SkillsManagePanel.tsx frontend/src/components/SkillPanel.tsx frontend/src/components/TerminalDrawer.tsx
git commit -m "feat(frontend): <StatusPanel> <SettingsPanel> <SkillsManagePanel> <SkillPanel> <TerminalDrawer>"
```

---

## Phase G — Wire it up

### Task 22: App.tsx (router + provider stack + Sidenav)

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Implement `frontend/src/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Sidenav } from "./components/Sidenav";
import { HealthDot } from "./components/HealthDot";
import { ChatPanel } from "./components/ChatPanel";
import { StatusPanel } from "./components/StatusPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SkillsManagePanel } from "./components/SkillsManagePanel";
import { SkillPanel } from "./components/SkillPanel";
import { TerminalDrawer } from "./components/TerminalDrawer";
import { ToastProvider } from "./state/ToastContext";
import { useHashRoute } from "./useHashRoute";

export function App() {
  const { route, navigate } = useHashRoute();
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);

  // Track cwd via a small window event the ChatPanel dispatches.
  // (Keeps the ChatProvider scoped to ChatPanel without lifting state.)
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
      <div style={{ display: "flex", height: "100vh" }}>
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

- [ ] **Step 2: Verify dev server renders without error**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx vite --port 5175 &
VITE_PID=$!
sleep 4
curl -sS http://127.0.0.1:5175/ | head -10
kill $VITE_PID 2>/dev/null
```

Expected: HTML with `<div id="root">`.

- [ ] **Step 3: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/src/App.tsx
git commit -m "feat(frontend): <App> wires router + providers + Sidenav + panels"
```

---

### Task 23: Update server tests (SPA-asset assertions)

The existing `src/server.test.ts` has 3 SPA-asset tests that target the vanilla SPA. They need updating for the React build output.

**Files:**
- Modify: `src/server.test.ts`

- [ ] **Step 1: Read the existing SPA-asset tests**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
grep -n "GET / serves the SPA" src/server.test.ts
```

- [ ] **Step 2: Build the React app once to populate `public/`**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
cd frontend && npx vite build && cd ..
ls public/
```

Expected: `public/` contains `index.html`, `assets/`. Note: this OVERWRITES the vanilla SPA. That's intentional.

- [ ] **Step 3: Replace the SPA-asset tests in `src/server.test.ts`**

Find each of the 3 tests:

- `test("GET / serves the SPA index.html", ...)`
- `test("GET /css/app.css serves the design-token stylesheet", ...)`
- `test("GET /js/<module>.js serves each behavior module", ...)`

Replace the index.html test body to assert against the React build output. Replace the css/js tests with a check for `/assets/index-*.js` (Vite's hashed output):

```ts
test("GET / serves the React-built index.html", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      const html = await res.text();
      assert.match(html, /<div id="root">/);
      assert.match(html, /\/assets\//);
    },
  }));
});

test("GET /assets/index-*.js serves the React bundle", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const html = await (await fetch(`${url}/`)).text();
      const m = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
      assert.ok(m, "index.html should reference /assets/index-*.js");
      const res = await fetch(`${url}/assets/${m[1]}`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.length > 100, "bundle should have content");
    },
  }));
});
```

Delete the css/app.css test and the js/<module>.js test (no longer applicable to the React build).

- [ ] **Step 4: Run server tests**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
npm test -- src/server.test.ts
```

Expected: PASS (16/16 — was 18 with the old SPA-asset tests, now 17 with the 2 new ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add public/ src/server.test.ts
git commit -m "chore(server): update SPA-asset tests for React build output"
```

---

### Task 24: Delete vanilla SPA files

**Files:**
- Delete: `public/index.html` (already overwritten by Vite build in Task 23)
- Delete: `public/css/`
- Delete: `public/js/`
- Delete: `public/assets/.vite/` (Vite cache)

- [ ] **Step 1: Verify vanilla files are gone from git**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git status --short public/
```

Expected: only React-built files (`index.html`, `assets/`).

- [ ] **Step 2: Run typecheck + all tests**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
npx tsc --noEmit
cd frontend && npx tsc --noEmit && cd ..
TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test \
  src/server.test.ts \
  src/agent/acp/jsonrpc.test.ts \
  src/agent/acp/mapping.test.ts \
  src/agent/acp/prompt-content.test.ts \
  src/agent/acp/image-resize.test.ts \
  src/agent/acp/index.test.ts \
  2>&1 | tail -8
```

Expected: 0 TS errors (backend), 0 TS errors (frontend); 60+ tests pass.

- [ ] **Step 3: Run frontend vitest suite**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npm test -- --run
```

Expected: All component + hook tests pass (~50 tests).

- [ ] **Step 4: Commit any remaining changes**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add -A
git status --short
git commit -m "chore(frontend): confirm vanilla SPA deleted; React build is the only public/ output" --allow-empty
```

---

### Task 25: Live smoke + final commit

**Files:** none (verification only)

- [ ] **Step 1: Build the React app**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npm run build
ls ../public/
```

Expected: `index.html` + `assets/index-*.js`, `assets/index-*.css`.

- [ ] **Step 2: Start backend with stub agent**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
JARVIS_BRIDGE_WORKSPACE=/tmp/jb-react PORT=3201 node -r ts-node/register src/index.ts > /tmp/jb-react.log 2>&1 &
echo $! > /tmp/jb-react.pid
sleep 4
curl -sS http://127.0.0.1:3201/health
echo
```

Expected: `{"ok":true}`.

- [ ] **Step 3: Smoke the SPA via the served HTML**

```bash
curl -sS http://127.0.0.1:3201/ | head -15
echo
curl -sS http://127.0.0.1:3201/chat/init
```

Expected: HTML contains `<div id="root">` and `/assets/...`; `/chat/init` returns a session.

- [ ] **Step 4: Smoke the SSE chat round-trip**

```bash
SID=$(curl -sS http://127.0.0.1:3201/chat/init | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).sessionId)")
curl -sN -X POST -H 'Content-Type: application/json' \
  --data "{\"message\":\"hello\",\"sessionId\":\"$SID\"}" \
  http://127.0.0.1:3201/chat/send
```

Expected: `data: {"type":"error",...}` + `data: {"type":"done"}` (stub backend).

- [ ] **Step 5: Kill server**

```bash
kill "$(cat /tmp/jb-react.pid)" 2>/dev/null
pkill -f "ts-node src/index.ts" 2>/dev/null
sleep 1
echo done
```

- [ ] **Step 6: Done**

All Phase 4 deliverables replaced. The backend is unchanged; the SPA is now a React + Vite production build at `public/`. Phase 5 (JARVIS HUD) can be done as a separate plan that only touches `frontend/src/styles/tokens.css` and adds `hud.css` + `hud.js` + `holo.js`.
