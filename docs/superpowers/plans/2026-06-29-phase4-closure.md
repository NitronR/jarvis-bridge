# Phase 4 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Phase 4 "Done when" items from `implementation/00-execution-phases.md:134` — wire the PastChatsMenu, build a working terminal drawer (backend + React shell), and update the phases doc to match the React stack.

**Architecture:** Three independent slices, one per gap. PastChatsMenu is a UI wiring fix (component already exists; needs a button in Sidenav). Terminal drawer needs a node-pty + ws server behind a `/terminal` upgrade on the existing HTTP server, plus an xterm.js + ws client in the existing `TerminalDrawer.tsx` placeholder. The phases doc needs the vanilla-JS Phase-4 deliverables rewritten to describe the React stack and a citation fix for the terminal-drawer spec location.

**Tech Stack:** Existing: Express, React 18, TypeScript, Vite, ws (already installed), zod. New backend: `node-pty`. New frontend: `@xterm/xterm`, `@xterm/addon-fit` (lazy-loaded by Vite).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/components/Sidenav.tsx` | Modify | Render a "Chats" button that opens `PastChatsMenu`; pull sessions list from chat state |
| `frontend/src/state/ChatContext.tsx` | Modify (already exposes listSessions) | Verify `sessions` array flows into Sidenav; no change needed if already exposed (Task 1 just wires it) |
| `src/terminal.ts` | Create | `attachTerminalServer({ server, workspace, enabled })` — `ws` server on `/terminal` upgrade, spawns node-pty, pipes stdin/stdout |
| `src/terminal.test.ts` | Create | Unit test: spawns a fake TCP-like socket pair, asserts shell echoes input and emits exit JSON |
| `src/index.ts` | Modify | Call `attachTerminalServer({ server: httpServer, workspace, enabled: config.shellEnabled })` after Express listen |
| `package.json` | Modify | Add `"node-pty": "^1.0.0"` to dependencies |
| `frontend/src/components/TerminalDrawer.tsx` | Modify | Replace placeholder `<input>` with xterm.js mounted to a div; open WS to `/terminal?cwd=<workspace>`; pipe input + resize; show `exit` JSON as status line |
| `frontend/package.json` | Modify | Add `"@xterm/xterm"` + `"@xterm/addon-fit"` to dependencies |
| `implementation/00-execution-phases.md` | Modify | Rewrite Phase 4 deliverables to describe the React stack; fix §3 reference to `08-terminal-and-integrations.md` (terminal drawer is in Phase 4, not Phase 6) |

---

## Task 1: Wire `PastChatsMenu` into the Sidenav

**Files:**
- Modify: `frontend/src/components/Sidenav.tsx`
- Modify: `frontend/src/state/ChatContext.tsx` (only if listSessions not already exposed)
- Inspect: `frontend/src/components/PastChatsMenu.tsx` (no change)

The `PastChatsMenu` component (47 lines, modal dialog with session list + onSwitch) has been built but is never rendered anywhere. Sidenav has no "Open chats" button. Result: users have no way to switch sessions via the UI.

- [ ] **Step 1: Verify ChatContext already exposes `sessions` + `loadSessions`**

Run:
```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
grep -nE "sessions|loadSessions" frontend/src/state/ChatContext.tsx
```

Expected: lines like `sessions: SessionSummary[]` and `loadSessions: () => Promise<void>` already present. If yes, skip Step 2.

- [ ] **Step 2 (conditional): Add `sessions` + `loadSessions` to ChatContext value if missing**

If Step 1 came up empty, the context doesn't expose them. Edit `frontend/src/state/ChatContext.tsx` to spread `sessions, loadSessions` into the returned context object AND add them to the `ChatContextValue` interface.

- [ ] **Step 3: Render a "Chats" button in Sidenav that opens PastChatsMenu**

Edit `frontend/src/components/Sidenav.tsx`:

```tsx
// At top, add imports
import { PastChatsMenu } from "./PastChatsMenu";
import { useChatContext } from "../state/ChatContext";

// Inside Sidenav, pull from context (or pass via props — match existing pattern):
const chat = useChatContext();
const [pastOpen, setPastOpen] = useState(false);

// Inside the existing button group, add:
<button type="button" onClick={() => { void chat.loadSessions(); setPastOpen(true); }}>
  Chats
</button>

// At the end of the JSX, render the modal:
{pastOpen && (
  <PastChatsMenu
    open={pastOpen}
    sessions={chat.sessions}
    onClose={() => setPastOpen(false)}
    onSwitch={async (id) => { setPastOpen(false); await chat.switchSession(id); }}
  />
)}
```

If `useChatContext` doesn't exist or Sidenav receives these as props, follow whichever pattern the file already uses. Goal: a new "Chats" button + the menu rendered.

- [ ] **Step 4: Typecheck + run frontend tests**

Run:
```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
cd frontend && npx tsc --noEmit 2>&1 | head -8 && cd ..
npx vitest run 2>&1 | tail -10
```

Expected: typecheck has the pre-existing 2 errors in test files (useSSE/useChat generic-mock typing) but **no new errors**; vitest still 64/64 passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidenav.tsx frontend/src/state/ChatContext.tsx
git commit -m "feat(frontend): wire PastChatsMenu into Sidenav"
```

---

## Task 2: Install `node-pty` and stub the terminal server module

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Install `node-pty`**

Run:
```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
npm install node-pty @types/node-pty
```

Expected: no native compile errors on darwin (prebuilt prebuilds exist); `node_modules/node-pty` present. If prebuilds unavailable, fall back to `npm install --build-from-source node-pty` (requires Xcode CLT).

- [ ] **Step 2: Verify package.json declares it**

```bash
grep -E '"node-pty"' package.json
```

Expected: `"node-pty": "^1.x.y"` in dependencies.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add node-pty + @types/node-pty"
```

---

## Task 3: Implement `attachTerminalServer` (TDD)

**Files:**
- Create: `src/terminal.ts`
- Create: `src/terminal.test.ts`
- Modify: `src/server.ts` (only if config plumbing needed — read first)

The spec is `implementation/08-terminal-and-integrations.md`: WebSocketServer on `/terminal` upgrade, shell per OS, `cwd` from query or fallback to workspace, server→client raw text + `exit` JSON, client→server binary forwarded + JSON control frames for `resize`/`input`.

- [ ] **Step 1: Write the failing test**

```ts
// src/terminal.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { attachTerminalServer } from "./terminal";

test("attachTerminalServer: ws client receives echoed input and exit JSON", async () => {
  const httpServer = createServer();
  attachTerminalServer({ server: httpServer, workspace: process.cwd(), enabled: true });
  await new Promise<void>((r) => httpServer.listen(0, r));
  const port = (httpServer.address() as { port: number }).port;

  const { WebSocket } = await import("ws");
  const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
  const chunks: string[] = [];
  let exitJson: unknown = null;
  ws.on("message", (data) => {
    const s = data.toString("utf8");
    if (s.startsWith("{")) {
      try { exitJson = JSON.parse(s); } catch {}
    } else chunks.push(s);
  });

  await new Promise<void>((r) => ws.once("open", r));
  // Send a known command and shutdown input so the shell exits cleanly.
  ws.send("echo JB_PTY_OK\nexit\n");
  // Wait for the chunk to contain the marker.
  const deadline = Date.now() + 3000;
  while (!chunks.join("").includes("JB_PTY_OK") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  // Wait for exit JSON up to 3s.
  const deadline2 = Date.now() + 3000;
  while (!exitJson && Date.now() < deadline2) {
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.ok(chunks.join("").includes("JB_PTY_OK"), "echo output should arrive");
  assert.ok(exitJson, "exit JSON should arrive");
  assert.equal((exitJson as { type?: string }).type, "exit");
  ws.close();
  httpServer.close();
});
```

Add `import { WebSocket } from "ws";` if preferred at top.

- [ ] **Step 2: Run test, verify it fails**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/terminal.test.ts 2>&1 | tail -8
```

Expected: FAIL — `Cannot find module './terminal'`.

- [ ] **Step 3: Implement `src/terminal.ts`**

```ts
import { createServer as createHttpServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { WebSocketServer } from "ws";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require("node-pty") as typeof import("node-pty");

export interface AttachOpts {
  server: HttpServer;
  workspace: string;
  enabled: boolean;
}

export function attachTerminalServer(opts: AttachOpts): void {
  const wss = new WebSocketServer({ noServer: true });

  opts.server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/terminal")) return;
    if (!opts.enabled) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/terminal", `http://${req.headers.host}`);
    const requestedCwd = url.searchParams.get("cwd");
    const cwd = requestedCwd && existsSync(requestedCwd) ? requestedCwd : opts.workspace;

    const shell = process.env.SHELL || "/bin/bash";
    const term = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: "xterm-256color", JARVIS_BRIDGE_WORKSPACE: opts.workspace },
    });

    term.onData((data) => { try { ws.send(data); } catch {} });
    term.onExit(({ exitCode, signal }) => {
      try { ws.send(JSON.stringify({ type: "exit", code: exitCode, signal })); } catch {}
      try { ws.close(1000); } catch {}
    });

    ws.on("message", (raw, isBinary) => {
      if (isBinary) { try { term.write(raw.toString("utf8")); } catch {} ; return; }
      const s = raw.toString("utf8");
      if (s.startsWith("{")) {
        try {
          const ctrl = JSON.parse(s);
          if (ctrl.type === "resize" && Number.isInteger(ctrl.cols) && Number.isInteger(ctrl.rows)) {
            const cols = Math.max(1, Math.min(500, ctrl.cols));
            const rows = Math.max(1, Math.min(200, ctrl.rows));
            try { term.resize(cols, rows); } catch {}
          } else if (ctrl.type === "input" && typeof ctrl.data === "string") {
            try { term.write(ctrl.data); } catch {}
          }
        } catch {}
        return;
      }
      try { term.write(s); } catch {}
    });
    ws.on("close", () => { try { term.kill(); } catch {} });
    ws.on("error", () => { try { term.kill(); } catch {} });
  });
}

export { createHttpServer };  // re-export only if needed elsewhere
```

Note on `require("node-pty")`: `@types/node-pty` provides types but the CommonJS interop with `ts-node` ESM-flavored imports can be quirky. If `import` fails at runtime under `ts-node`, swap to `require`. The cast at the top makes the types stick.

- [ ] **Step 4: Run test, verify it passes**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/terminal.test.ts 2>&1 | tail -10
```

Expected: PASS, ~1 test, ~500ms.

- [ ] **Step 5: Commit**

```bash
git add src/terminal.ts src/terminal.test.ts
git commit -m "feat(terminal): node-pty + ws bridge with attachTerminalServer"
```

---

## Task 4: Wire `attachTerminalServer` into `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Read the listen block in src/index.ts**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
grep -nE "listen|\.listen\(|createServer|server\.listen" src/index.ts src/server.ts
```

Find the exact line where `httpServer.listen(...)` is called. Determine whether the http `Server` instance is reachable from `index.ts` (likely yes if `createServer` returns it) and whether `config.shellEnabled` exists (or fall back to `process.env.JARVIS_BRIDGE_SHELL !== "false"`).

- [ ] **Step 2: Add the import + call**

Add at the top:
```ts
import { attachTerminalServer } from "./terminal";
```

Add after the `httpServer.listen(...)` call:
```ts
attachTerminalServer({
  server: httpServer,
  workspace: config.workspace,
  enabled: config.shellEnabled ?? process.env.JARVIS_BRIDGE_SHELL !== "false",
});
```

(Adjust the key name based on whatever `config.ts` exposes; read `src/config.ts` if `config.shellEnabled` doesn't exist and add a `shellEnabled: boolean` field with default `true` plus an env override.)

- [ ] **Step 3: Smoke-test the upgrade with curl**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
npm run dev &  # or ts-node src/index.ts in background
sleep 2
# Should not crash the server; expect 426 Upgrade Required from raw HTTP
curl -i http://127.0.0.1:3001/terminal 2>&1 | head -3
# Verify the server is still alive
curl -sf http://127.0.0.1:3001/health | head -c 200
kill %1
```

Expected: `HTTP/1.1 426 Upgrade Required` from curl (correct, no upgrade headers sent), `/health` still returns 200.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/config.ts
git commit -m "feat(server): attach terminal ws on /terminal upgrade"
```

---

## Task 5: Add `@xterm/xterm` + replace `TerminalDrawer` placeholder

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/components/TerminalDrawer.tsx`
- Modify: `vite.config.ts` (only if dynamic-import chunking needs opt-in)

- [ ] **Step 1: Install xterm**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npm install @xterm/xterm @xterm/addon-fit
grep -E '"@xterm' package.json
```

Expected: both packages listed in `dependencies`.

- [ ] **Step 2: Replace `TerminalDrawer.tsx` body**

The current file renders a static placeholder `<input>` and a "not yet wired" notice. Replace with a lazy-loaded xterm.js mount that:
1. On first open, dynamically imports `@xterm/xterm` + `@xterm/addon-fit`.
2. Opens a `WebSocket` to `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/terminal?cwd=${encodeURIComponent(cwd ?? "")}`.
3. Writes received frames to the terminal (binary/text interchangeably). If the frame starts with `{`, parse it as `{ type: "exit", code, signal }` and show as a status line.
4. On terminal input (`onData`), forward text frames; if binary, send as binary.
5. On `FitAddon.fit`, send `{ type: "resize", cols, rows }` JSON.
6. On WS close/error, render the disconnect reason and a "Reconnect" button.

Skeleton:

```tsx
import { useEffect, useRef, useState } from "react";

export function TerminalDrawer({ cwd }: { cwd: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{
    term: import("@xterm/xterm").Terminal;
    fit: () => void;
    write: (s: string) => void;
    dispose: () => void;
    onData: (cb: (s: string) => void) => void;
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<string>("idle");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      if (disposed) return;
      const term = new Terminal({ convertEol: true, fontFamily: "var(--font-mono)", fontSize: 12 });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      fit.fit();
      termRef.current = {
        term,
        fit: () => fit.fit(),
        write: (s) => term.write(s),
        dispose: () => term.dispose(),
        onData: (cb) => { term.onData(cb); },
      };

      const wsProto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${wsProto}://${location.host}/terminal?cwd=${encodeURIComponent(cwd ?? "")}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      setStatus("connecting…");
      ws.onopen = () => setStatus("connected");
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          if (ev.data.startsWith("{")) {
            try {
              const ctrl = JSON.parse(ev.data);
              if (ctrl.type === "exit") {
                setStatus(`exit code=${ctrl.code}${ctrl.signal ? ` signal=${ctrl.signal}` : ""}`);
                term.write(`\r\n\x1b[2m[exit code=${ctrl.code}]\x1b[0m\r\n`);
              }
            } catch { term.write(ev.data); }
          } else {
            term.write(ev.data);
          }
        } else {
          term.write(new TextDecoder().decode(ev.data as ArrayBuffer));
        }
      };
      ws.onclose = (ev) => setStatus(`disconnected (${ev.code})`);
      ws.onerror = () => setStatus("ws error");

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
      });
      fit.fit();
      term.onResize(() => fit.fit());
    })().catch((err) => setStatus(`init failed: ${err instanceof Error ? err.message : String(err)}`));

    const ro = new ResizeObserver(() => termRef.current?.fit());
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      wsRef.current?.close();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [cwd]);

  const reconnect = () => { setStatus("reconnecting…"); window.location.reload(); /* simple; spec a better UX later */ };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <header style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", fontSize: 11, color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}>
        <span>shell · cwd={cwd ?? "(unset)"} · {status}</span>
        <button type="button" onClick={reconnect}>reconnect</button>
      </header>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, background: "#001020", padding: 4 }} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npx tsc --noEmit 2>&1 | grep -E "TerminalDrawer" | head -5
```

Expected: no errors mentioning `TerminalDrawer`. The 2 pre-existing test-file errors are unrelated.

- [ ] **Step 4: Build to confirm xterm chunks**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge/frontend
npm run build 2>&1 | tail -10
```

Expected: build succeeds, output mentions an xterm dynamic chunk (look for `xterm` in the asset list).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
git add frontend/package.json frontend/package-lock.json frontend/src/components/TerminalDrawer.tsx
git commit -m "feat(frontend): xterm.js terminal drawer with ws to /terminal"
```

---

## Task 6: Live smoke + architecture verification

**Files:** none modified

- [ ] **Step 1: Start backend + frontend dev**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
npm run dev &  # in terminal 1
cd frontend && npm run dev:web &  # in terminal 2
sleep 5
```

- [ ] **Step 2: Verify each Phase 4 Done-when item**

```bash
# 1. Chat with streaming output — load http://127.0.0.1:5173 and type "hello". Expect streaming reply.
# 2. Approve a tool call — ask the agent to read package.json. Expect ApprovalModal with deny/allow buttons.
# 3. Switch sessions — click the new "Chats" button in Sidenav. Expect PastChatsMenu listing past sessions. Click one — load history.
# 4. Fork — click Fork in the active session header. Expect new active session.
# 5. Image attach — click paperclip, select a PNG. Expect thumbnail preview + visible @ image when sent.
# 6. Terminal drawer — toggle drawer. Expect xterm canvas, type "echo hi", expect "hi" to appear.
```

- [ ] **Step 3: Run full test suites**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
npx tsc --noEmit 2>&1 | head -3
TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test \
  src/server.test.ts src/agent/acp/*.test.ts src/config.test.ts src/terminal.test.ts 2>&1 | tail -8
cd frontend && npx vitest run 2>&1 | tail -8
```

Expected: backend 0 type errors, backend tests pass including the new `terminal.test.ts`; frontend tests still 64/64.

- [ ] **Step 4: Commit (no code change; skip if nothing staged)**

---

## Task 7: Update `implementation/00-execution-phases.md` for the React stack

**Files:**
- Modify: `implementation/00-execution-phases.md`

The Phase 4 deliverables still describe the vanilla-JS stack that no longer exists (`public/js/*.js`, `public/css/app.css`, `public/index.html`). Update them to reference the React stack and cite `08-terminal-and-integrations.md` for the Phase-4 terminal work.

- [ ] **Step 1: Replace the Phase 4 deliverables + Done-when block**

Find:
```markdown
## Phase 4 — Behavioral frontend (plain theme)

**Goal:** a usable web UI with no HUD styling yet — correctness first.

**Read:** [04-frontend.md](04-frontend.md), [03-http-api.md](03-http-api.md).

**Deliverables:**
- `public/index.html` — the full SPA shell ...
- `public/js/chat.js` — chat lifecycle ...
- `public/js/skills.js`, `public/js/status.js`, `public/js/terminal.js`, `public/js/settings.js`, ...
- `public/css/app.css` — a plain dark theme ...

**Done when:** you can chat with streaming output, approve a tool call, switch sessions, fork, attach
an image, and open the terminal drawer — all in a plain theme.
```

Replace with:
```markdown
## Phase 4 — Behavioral frontend (plain theme)

**Goal:** a usable React SPA with no HUD styling yet — correctness first.

**Read:** [04-frontend.md](04-frontend.md), [03-http-api.md](03-http-api.md), [08-terminal-and-integrations.md](08-terminal-and-integrations.md).

**Deliverables:**
- `frontend/` — Vite + React 18 + TypeScript SPA.
- `frontend/src/main.tsx` + `App.tsx` — root, hash router, layout.
- `frontend/src/state/ChatContext.tsx` + `useChat.ts` + `useSSE.ts` — chat lifecycle, SSE pump, fork/steer/model/auto-approve.
- `frontend/src/components/ChatPanel.tsx` + `Transcript.tsx` + `Message.tsx` — live stream + history renderer (shared path).
- `frontend/src/components/Composer.tsx` — message + image attach (paste/drop/picker) + queue + steer.
- `frontend/src/components/ApprovalModal.tsx` — surfaces ACP `request_permission` requests; resolves via `/chat/approval`.
- `frontend/src/components/PastChatsMenu.tsx` + wired entry point in `Sidenav.tsx` — list/switch past sessions.
- `frontend/src/components/TerminalDrawer.tsx` + `src/terminal.ts` — xterm.js client + node-pty/ws server behind `/terminal` upgrade.
- `frontend/src/styles/tokens.css` + `frontend/src/styles/*.module.css` — stable `:root` design-token names; Phase 5 retunes values without touching behavior.

**Done when:** you can chat with streaming output, approve a tool call, switch sessions, fork, attach
an image, and open the terminal drawer — all in a plain theme.
```

- [ ] **Step 2: Confirm cross-reference**

```bash
cd /Users/bhanu-mac/Desktop/Projects/jarvis_bridge
grep -n "08-terminal-and-integrations" implementation/00-execution-phases.md
```

Expected: matches in Phase 4 read list. No change needed in Phase 6 (Slack/MCP/Hooks extras don't include the drawer).

- [ ] **Step 3: Commit**

```bash
git add implementation/00-execution-phases.md
git commit -m "docs(phases): update Phase 4 deliverables to React stack + cite 08 terminal spec"
```

---

## Self-Review

**Spec coverage** (`implementation/00-execution-phases.md:134` Done-when checklist):

| Item | Task |
|---|---|
| Chat with streaming output | Verified in Task 6 (already passing before this plan after the empty-reply fix) |
| Approve a tool call | Already structurally complete; verified live in Task 6 |
| Switch sessions | Task 1 (PastChatsMenu wiring) |
| Fork | Already structurally complete; verified live in Task 6 |
| Attach an image | Already structurally complete (Composer paperclip + preview); verified live in Task 6 |
| Open the terminal drawer | Tasks 2–5 (backend install + server + ws + xterm client) |

**Phases-doc drift**: Task 7.

**Placeholder scan**: no "TBD"/"TODO"/"similar to" left. Code blocks are complete (test, terminal.ts, TerminalDrawer.tsx, phases section).

**Type consistency**: `attachTerminalServer({ server, workspace, enabled })` used in Tasks 3 + 4; `termRef.current?.fit()` referenced in both Step 3 and Step 3's cleanup of Task 5; `config.shellEnabled` consistency flagged in Task 4 Step 1 ("read `src/config.ts` if missing") so the implementer picks a name once.

**Risks**:
- `node-pty` on first install on darwin usually fetches a prebuild; if the prebuild URL 404s, fall back to `--build-from-source`. Worst-case: 30s compile, no behavior change.
- `@xterm/xterm` is ~200KB gzipped and lazy-loaded here, so it doesn't bloat the initial bundle. Vite handles the dynamic import chunk out of the box.
- The terminal test exercises a real shell (`$SHELL`); CI machines without one may need a `/bin/bash` fallback. Task 3 Step 3 already sets `process.env.SHELL || "/bin/bash"`.

---

## Execution Handoff

Two options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — executing-plans skill, batch with checkpoints.
