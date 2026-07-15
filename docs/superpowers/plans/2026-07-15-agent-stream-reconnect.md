# Agent Stream Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser tab that disconnects mid-turn (refresh, network blip, tab close) and reconnects resumes the in-flight agent response instead of silently killing it or losing it.

**Architecture:** Every patch produced by an in-flight ACP turn is buffered on the session's `SessionContext` (`activeTurn.patches`) and optionally forwarded live to one attached viewer (`activeTurn.viewerCallback`), independent of whether any particular HTTP request is still consuming the turn's generator. `POST /chat/send` stops treating client disconnect as cancellation. A new `GET /chat/stream` endpoint lets a reconnecting tab replay the buffer and keep receiving live patches. `GET /chat/init` skips the history-clobbering `loadSession()` call when a turn is already live. An idle-turn grace period cancels a turn that nobody has watched for 5 minutes.

**Tech Stack:** TypeScript (Node `node:test` backend, Vitest frontend), Express, ACP JSON-RPC over stdio, React.

## Global Constraints

- Single viewer, latest wins: only one live connection is ever attached to a turn's output at a time.
- Disconnect never auto-cancels a turn; only `POST /chat/cancel` does, or the idle-turn grace-period reaper (default 5 minutes, `JARVIS_BRIDGE_IDLE_TURN_GRACE_MS`).
- No multi-viewer broadcast, no browser-lifecycle-event-based tab-close detection, no cross-restart persistence of in-flight turns — all explicitly out of scope (see `docs/superpowers/specs/2026-07-15-agent-stream-reconnect-design.md`, Non-goals).
- Follow `docs/acp-notes.md`'s existing guidance on `SessionContext`/`handleSessionUpdate`/replay — this plan's Task 1 modifies that exact area.

---

### Task 1: Backend core — `activeTurn` buffering, `getActiveTurn`, idle-turn reaper

**Files:**
- Modify: `src/agent/types.ts`
- Modify: `src/agent/acp/index.ts`
- Modify: `test/fixtures/fake-streaming-agent.cjs`
- Test: `src/agent/acp/index.test.ts`

**Interfaces:**
- Produces: `ActiveTurnHandle` (`src/agent/types.ts`): `{ patches: ChatPatch[]; attach(onPatch: ((patch: ChatPatch) => void) | null): () => void }`.
- Produces: `AgentSession.getActiveTurn?(): ActiveTurnHandle | null` (optional interface method).
- Produces: `AcpAgentSession.getActiveTurn(): ActiveTurnHandle | null` (concrete implementation).
- Consumes: existing `SessionContext`, `resetTurnState`, `patchFromPromptResult`, `AcpRequestError`, `AcpConnectionClosedError` from the same file (unchanged).

- [ ] **Step 1: Add cancel-event logging to the fake agent fixture**

The fixture already handles `session/cancel` as a silent no-op notification. Add an event log so tests can assert it was (not) received, following the existing env-var-driven pattern in this file (e.g. `X_FAKE_AGENT_PERMISSION_RESULT_FILE`).

In `test/fixtures/fake-streaming-agent.cjs`, near the other env-var reads (after the `elicitationResultFile` block, around line 104), add:

```js
const eventLogFile = process.env.X_FAKE_AGENT_EVENT_LOG_FILE || null;
function logEvent(method) {
  if (!eventLogFile) return;
  fs.appendFileSync(eventLogFile, JSON.stringify({ method, t: Date.now() }) + "\n");
}
```

In the `rl.on("line", ...)` handler's `switch (msg.method)`, add a call at the very top of the switch body (before the `switch`, so every method is logged regardless of case):

```js
  switch (msg.method) {
```
becomes
```js
  logEvent(msg.method);
  switch (msg.method) {
```

- [ ] **Step 2: Write the failing test for "disconnect during a turn does not send session/cancel"**

Add to `src/agent/acp/index.test.ts` (near the existing `cancel()` test, using the same spawn pattern as other tests in this file):

This test uses the existing `newBackend(env)` helper already defined near the top of this file (wraps `AcpAgentBackend.spawn` with `FAKE_AGENT` and merged env vars).

```ts
test("activeTurn buffers patches independent of whether the generator is being pulled", async () => {
  const eventLogFile = path.join(os.tmpdir(), `evlog-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const backend = await newBackend({
    X_FAKE_AGENT_NEW_TEXT: JSON.stringify(["one", "two", "three"]),
    X_FAKE_AGENT_DELAY_MS: "10",
    X_FAKE_AGENT_EVENT_LOG_FILE: eventLogFile,
  });
  try {
    const session = await backend.createSession({ cwd: process.cwd() }) as AcpAgentSession;
    const iter = session.sendMessage("hi")[Symbol.asyncIterator]();
    // Pull exactly one patch, then stop pulling entirely — simulating an
    // HTTP handler that has stopped consuming the generator after a client
    // disconnect, without ever calling cancel().
    await iter.next();
    const handle = session.getActiveTurn();
    assert.ok(handle, "activeTurn should exist while the turn is still running");
    // Wait past the fake agent's full send duration without pulling again.
    await new Promise((r) => setTimeout(r, 200));
    const handleAfter = session.getActiveTurn();
    assert.ok(handleAfter, "turn should still be tracked as active — nothing cancelled it");
    assert.ok(
      handleAfter!.patches.length >= 2,
      "patches should keep accumulating via onPatch even though nobody is pulling the generator",
    );
    const log = fs.existsSync(eventLogFile)
      ? fs.readFileSync(eventLogFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.ok(
      !log.some((e: { method: string }) => e.method === "session/cancel"),
      "session/cancel must never be sent just because nobody is pulling the generator",
    );
  } finally {
    await backend.shutdown();
    fs.rmSync(eventLogFile, { force: true });
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: FAIL — `session.getActiveTurn is not a function` (method doesn't exist yet).

- [ ] **Step 4: Add `ActiveTurnHandle` and `getActiveTurn` to the shared types**

In `src/agent/types.ts`, add after the `ChatHistoryEntry` type (before `AgentSession`):

```ts
export interface ActiveTurnHandle {
  // Patches produced by this turn so far, oldest first (snapshot at call time).
  patches: ChatPatch[];
  // Register to receive patches emitted after this call, replacing any
  // previous registration (single viewer, latest wins). Pass null to mark
  // this caller as a connected-but-passive viewer (e.g. the original
  // /chat/send request, which already receives patches by iterating the
  // generator directly and doesn't need a push callback) — this still
  // participates in the idle-turn grace-period bookkeeping. Returns a
  // detach function to call when this viewer disconnects.
  attach(onPatch: ((patch: ChatPatch) => void) | null): () => void;
}
```

In `AgentSession` (same file), add after `consumeReplayHistory?(): ChatHistoryEntry[];`:

```ts
  getActiveTurn?(): ActiveTurnHandle | null;
```

- [ ] **Step 5: Restructure `SessionContext` and `sendMessage` in `src/agent/acp/index.ts`**

Add to `SessionContext` (after `wakeWaiter: (() => void) | null;`):

```ts
  // In-flight turn state, buffered independent of any HTTP consumer — see
  // docs/acp-notes.md and docs/superpowers/specs/2026-07-15-agent-stream-reconnect-design.md.
  activeTurn: {
    patches: ChatPatch[];
    viewerCallback: ((patch: ChatPatch) => void) | null;
    idleTimer: NodeJS.Timeout | null;
  } | null;
```

Add `activeTurn: null,` to the object returned by `makeSessionContext()`.

Add near the top-level helpers (e.g. just above `extractText`):

```ts
function getIdleTurnGraceMs(): number {
  const raw = process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
}
```

Add the import for `ActiveTurnHandle` to the existing `import type { ... } from "../types";` block in this file.

Replace the body of `AcpAgentSession.sendMessage` (the whole method, `src/agent/acp/index.ts:771-883` in the pre-change file) with:

```ts
  async *sendMessage(
    message: string,
    opts?: SendMessageOptions,
  ): AsyncIterable<ChatPatch> {
    if (this.closed) {
      yield { type: "error", message: "session is closed" };
      return;
    }
    if (this.ctx.busy) {
      if (!this.backend.capabilities.promptQueueing) {
        yield { type: "error", message: "session is busy" };
        return;
      }
      await new Promise<void>((resolve) => this.turnQueue.push(resolve));
      if (this.closed) {
        yield { type: "error", message: "session is closed" };
        return;
      }
    }
    this.ctx.busy = true;
    this.ctx.cancelRequested = false;
    resetTurnState(this.ctx.state);
    this.ctx.activeTurn = { patches: [], viewerCallback: null, idleTimer: null };

    try {
      const promptResult = buildAcpPrompt(message, opts?.images ?? [], {});
      if (!promptResult.ok) {
        yield { type: "error", message: promptResult.error };
        return;
      }

      const queue: ChatPatch[] = [];
      let wakeResolver: (() => void) | null = null;
      const makeWaiter = (): Promise<void> =>
        new Promise<void>((resolve) => {
          wakeResolver = resolve;
        });
      let waiter = makeWaiter();
      // Every patch destined for the client flows through here: buffered
      // onto activeTurn (so a later reattach can catch up) and forwarded
      // live to whichever viewer is currently attached, independent of
      // whether the original caller is still pulling this generator.
      const emit = (p: ChatPatch) => {
        queue.push(p);
        this.ctx.activeTurn?.patches.push(p);
        this.ctx.activeTurn?.viewerCallback?.(p);
        const w = wakeResolver;
        wakeResolver = null;
        w?.();
      };
      if (promptResult.skipped.length > 0) {
        emit({ type: "images-skipped", skipped: promptResult.skipped });
      }
      const blocks = promptResult.blocks;

      this.ctx.onPatch = (patches) => {
        for (const p of patches) emit(p);
      };
      let turnDone = false;
      const onAbort = () => {
        void this.cancel();
      };
      const signal = opts?.signal;
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      const promptPromise = this.backend
        .getConnection()
        .sendRequest("session/prompt", { sessionId: this.id, prompt: blocks })
        .then((result) => {
          const usagePatch = patchFromPromptResult(result as never, this.ctx.state);
          if (usagePatch) emit(usagePatch);
        })
        .catch((err: unknown) => {
          if (err instanceof AcpRequestError) {
            emit({ type: "error", message: err.message });
          } else if (err instanceof AcpConnectionClosedError) {
            emit({ type: "error", message: "agent connection closed" });
          } else if (this.ctx.cancelRequested) {
            // suppress cancellation-noise
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            emit({ type: "error", message: msg });
          }
        })
        .finally(() => {
          turnDone = true;
          emit({ type: "done" });
        });

      while (true) {
        while (queue.length > 0) {
          const p = queue.shift()!;
          yield p;
        }
        if (turnDone) break;
        waiter = makeWaiter();
        await waiter;
      }

      await promptPromise.catch(() => {
        /* already handled */
      });

      if (signal) signal.removeEventListener("abort", onAbort);
    } finally {
      this.ctx.busy = false;
      this.ctx.onPatch = null;
      if (this.ctx.activeTurn?.idleTimer) clearTimeout(this.ctx.activeTurn.idleTimer);
      this.ctx.activeTurn = null;
      const next = this.turnQueue.shift();
      if (next) next();
    }
  }

  getActiveTurn(): ActiveTurnHandle | null {
    const at = this.ctx.activeTurn;
    if (!at) return null;
    return {
      patches: at.patches.slice(),
      attach: (onPatch) => {
        if (at.idleTimer) {
          clearTimeout(at.idleTimer);
          at.idleTimer = null;
        }
        at.viewerCallback = onPatch;
        return () => {
          // Only re-arm if this is still the current registration — avoids a
          // stale detach (e.g. the original connection closing after a
          // reattach already took over) clobbering a newer viewer.
          if (at.viewerCallback !== onPatch) return;
          at.viewerCallback = null;
          at.idleTimer = setTimeout(() => {
            void this.cancel();
          }, getIdleTurnGraceMs());
        };
      },
    };
  }
```

(The explicit trailing `yield { type: "done" }` that used to follow the drain loop is gone — `done` is now emitted from the `promptPromise.finally()` callback via `emit()`, which pushes it into the same `queue` the drain loop already yields from, preserving ordering.)

- [ ] **Step 6: Run test to verify it passes**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: PASS for the new test. Also re-run the full file to confirm no regressions:
Run: `npm test` (from repo root)
Expected: all existing tests in this file still PASS (in particular "emits text-start... usage", "cancel() sends a session/cancel notification", and the busy-gate/queueing tests, since `sendMessage`'s external behavior is unchanged for a normally-consumed turn).

- [ ] **Step 7: Write the failing test for the idle-turn grace-period reaper**

Add to `src/agent/acp/index.test.ts`:

```ts
test("idle-turn reaper cancels a turn nobody has attached to after the grace period", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const eventLogFile = path.join(os.tmpdir(), `evlog-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS = "50";
  const backend = await newBackend({
    X_FAKE_AGENT_NEW_TEXT: JSON.stringify(["a", "b", "c", "d", "e"]),
    X_FAKE_AGENT_DELAY_MS: "10",
    X_FAKE_AGENT_EVENT_LOG_FILE: eventLogFile,
  });
  try {
    const session = await backend.createSession({ cwd: process.cwd() }) as AcpAgentSession;
    const iter = session.sendMessage("hi")[Symbol.asyncIterator]();
    await iter.next(); // let the turn actually start (activeTurn now exists)
    const handle = session.getActiveTurn()!;
    const detach = handle.attach(() => {}); // attach, then immediately detach — arms the reaper
    detach();
    t.mock.timers.tick(60); // past the 50ms grace period
    // Allow the fire-and-forget cancel() promise chain to settle.
    await new Promise((r) => setImmediate(r));
    const log = fs.readFileSync(eventLogFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(
      log.some((e: { method: string }) => e.method === "session/cancel"),
      "grace period elapsing with nobody attached must cancel the turn",
    );
  } finally {
    delete process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
    await backend.shutdown();
    fs.rmSync(eventLogFile, { force: true });
  }
});

test("a reattach before the grace period elapses clears the reaper timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const eventLogFile = path.join(os.tmpdir(), `evlog-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS = "50";
  const backend = await newBackend({
    X_FAKE_AGENT_NEW_TEXT: JSON.stringify(["a", "b", "c", "d", "e"]),
    X_FAKE_AGENT_DELAY_MS: "10",
    X_FAKE_AGENT_EVENT_LOG_FILE: eventLogFile,
  });
  try {
    const session = await backend.createSession({ cwd: process.cwd() }) as AcpAgentSession;
    const iter = session.sendMessage("hi")[Symbol.asyncIterator]();
    await iter.next();
    const handle = session.getActiveTurn()!;
    const detach1 = handle.attach(() => {});
    detach1(); // arms the reaper
    t.mock.timers.tick(30); // before the 50ms grace period
    const handle2 = session.getActiveTurn()!;
    handle2.attach(() => {}); // reattach — must clear the pending reaper timer
    t.mock.timers.tick(60); // now well past 50ms total, but reaper was cleared
    await new Promise((r) => setImmediate(r));
    const log = fs.existsSync(eventLogFile)
      ? fs.readFileSync(eventLogFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.ok(
      !log.some((e: { method: string }) => e.method === "session/cancel"),
      "a reattach before the grace period must clear the reaper, not just delay it",
    );
  } finally {
    delete process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
    await backend.shutdown();
    fs.rmSync(eventLogFile, { force: true });
  }
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: PASS for both new tests (the reaper logic in Step 5 already implements this; this step should already be green — if not, check that `getIdleTurnGraceMs()` reads `process.env` fresh on each call rather than caching it at module load).

- [ ] **Step 9: Commit**

```bash
git add src/agent/types.ts src/agent/acp/index.ts test/fixtures/fake-streaming-agent.cjs src/agent/acp/index.test.ts
git commit -m "feat(acp): buffer in-flight turn patches and add an idle-turn reaper"
```

---

### Task 2: Test fixture — `FakeSession`/`FakeBackend` patch delay + `getActiveTurn` simulation

**Files:**
- Modify: `test/fixtures/fakeBackend.ts`

**Interfaces:**
- Consumes: `ActiveTurnHandle` from `src/agent/types.ts` (Task 1).
- Produces: `FakeBackendOptions.patchDelayMs?: number`, `FakeSession.getActiveTurn(): ActiveTurnHandle | null` — consumed by Task 3/4/5's server tests.

- [ ] **Step 1: Write the failing test**

Add a new test file assertion isn't warranted for a pure test-fixture change with no independent behavior to assert outside its consumers — per this plan's task-sizing rules, this task's "test" is deferred to Task 3/4/5, which consume it directly. Instead, verify the fixture compiles and behaves as a plain script check:

Run: `npx tsc --noEmit`
Expected: FAIL — `patchDelayMs` and `getActiveTurn` don't exist yet, but nothing references them yet either, so this step is actually a no-op today. Skip ahead to Step 2 (implementation) and let Task 3/4/5's tests be the real verification.

- [ ] **Step 2: Implement the delay + activeTurn simulation**

In `test/fixtures/fakeBackend.ts`, update `FakeSession`:

```ts
export class FakeSession implements AgentSession {
  readonly id: string;
  private opts: { patches: ChatPatch[]; patchDelayMs: number };
  public steerHandler: ((p: string) => Promise<{ accepted: boolean; reason?: string }>) | null = null;
  public cancelled = 0;
  public sentMessages: Array<{ message: string; opts?: SendMessageOptions }> = [];
  public approvals: Array<{ requestId: string; optionId: string }> = [];
  public elicitations: Array<{ requestId: string; action: string; content?: Record<string, unknown> }> = [];
  private turnActive = false;
  private activeTurnPatches: ChatPatch[] = [];
  private activeTurnViewer: ((p: ChatPatch) => void) | null = null;
  constructor(id: string, patches: ChatPatch[], patchDelayMs = 0) {
    this.id = id;
    this.opts = { patches, patchDelayMs };
  }
  async *sendMessage(
    message: string,
    opts?: SendMessageOptions,
  ): AsyncIterable<ChatPatch> {
    this.sentMessages.push({ message, opts });
    this.turnActive = true;
    this.activeTurnPatches = [];
    try {
      for (const p of this.opts.patches) {
        if (opts?.signal?.aborted) {
          yield { type: "error", message: "aborted" };
          return;
        }
        if (this.opts.patchDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.opts.patchDelayMs));
        }
        this.activeTurnPatches.push(p);
        this.activeTurnViewer?.(p);
        yield p;
      }
    } finally {
      this.turnActive = false;
      this.activeTurnViewer = null;
    }
  }
  getActiveTurn(): ActiveTurnHandle | null {
    if (!this.turnActive) return null;
    return {
      patches: this.activeTurnPatches.slice(),
      attach: (onPatch) => {
        this.activeTurnViewer = onPatch;
        return () => {
          if (this.activeTurnViewer === onPatch) this.activeTurnViewer = null;
        };
      },
    };
  }
  async cancel(): Promise<void> {
    this.cancelled++;
  }
  async steer(p: string) {
    if (this.steerHandler) return this.steerHandler(p);
    return { accepted: false, reason: "no handler" };
  }
  resolveApproval(requestId: string, optionId: string): boolean {
    this.approvals.push({ requestId, optionId });
    return true;
  }
  resolveElicitation(
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): boolean {
    this.elicitations.push({ requestId, action, content });
    return true;
  }
  async close(): Promise<void> {}
}
```

Add `ActiveTurnHandle` to the existing `import type { ... } from "../agent/types";` block.

Add `patchDelayMs?: number;` to `FakeBackendOptions`, and thread it through the three places `FakeSession` is constructed in `FakeBackend`:

```ts
    if (opts.initialSessionId && opts.initialSessionPatches) {
      this.sessions.set(
        opts.initialSessionId,
        new FakeSession(opts.initialSessionId, opts.initialSessionPatches, opts.patchDelayMs ?? 0),
      );
    }
```

and in `createSession`:

```ts
  async createSession(opts?: { cwd?: string }) {
    const id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    const session = new FakeSession(
      id,
      this.opts.initialSessionPatches ?? [
        { type: "text-delta", index: 0, delta: "hi from fake" },
        { type: "done" } as ChatPatch,
      ],
      this.opts.patchDelayMs ?? 0,
    );
    this.sessions.set(id, session);
    this.createdSessions.push({ sessionId: id });
    this.createdWithCwd.set(id, opts?.cwd);
    return session;
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no compile errors).

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/fakeBackend.ts
git commit -m "test: add patch-delay and activeTurn simulation to FakeSession"
```

---

### Task 3: `POST /chat/send` — stop treating disconnect as cancel

**Files:**
- Modify: `src/server.ts:174-228` (the `/chat/send` route)
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes: `session.getActiveTurn?.(): ActiveTurnHandle | null` (Task 1/2), `FakeBackendOptions.patchDelayMs` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `src/server.test.ts`, near the existing `"POST /chat/send streams SSE patches..."` test:

```ts
test("disconnecting mid-stream does not cancel the turn", async () => {
  const sessionId = "sess-disconnect-1";
  const backend = new FakeBackend({
    initialSessionId: sessionId,
    initialSessionPatches: [
      { type: "text-delta", index: 0, delta: "a" },
      { type: "text-delta", index: 0, delta: "b" },
      { type: "text-delta", index: 0, delta: "c" },
      { type: "done" },
    ],
    patchDelayMs: 40,
  });
  await withServer(async (ws) => ({
    backend,
    fn: async (url) => {
      const controller = new AbortController();
      const sendPromise = fetch(`${url}/chat/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", sessionId }),
        signal: controller.signal,
      }).catch(() => null); // the client-side abort itself rejects this fetch
      await new Promise((r) => setTimeout(r, 20));
      controller.abort(); // simulate a page refresh mid-stream
      await sendPromise;
      // Give the still-running turn time to finish server-side.
      await new Promise((r) => setTimeout(r, 200));
      const session = backend.getSession(sessionId) as FakeSession;
      assert.equal(session.cancelled, 0, "disconnect must not call session.cancel()");
    },
  }));
});
```

Add `FakeSession` to the existing fixture import at the top of the file: `import { FakeBackend, FakeSession } from "../test/fixtures/fakeBackend";`

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: FAIL — `session.cancelled` is `1` (today's `req.on("close", () => signal.abort())` wiring cancels the turn).

- [ ] **Step 3: Fix `/chat/send` in `src/server.ts`**

Add `ChatPatch` to the existing type-only import: `import type { AgentBackend, AgentSession, ChatPatch, UsageTotals } from "./agent/types";`

Replace the `/chat/send` route body (`src/server.ts:174-228`) with:

```ts
  // ── POST /chat/send (SSE) ──────────────────────────────────────────
  app.post("/chat/send", chatJson, asyncRoute(async (req, res) => {
    const body = SendBodySchema.parse(req.body ?? {});
    const sessionId = body.sessionId ?? (await defaultSessionId(registry));
    if (!sessionId) {
      res.status(404).json({ error: "no session available" });
      return;
    }
    const session = await registry.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const writePatch = (patch: ChatPatch) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(patch)}\n\n`);
      const pt = (patch as { type?: string }).type;
      if (pt === "usage") {
        opts.sessionConfig
          ?.setLastUsage(sessionId, (patch as { usage: UsageTotals }).usage)
          .catch(() => {});
      }
    };
    // A disconnect (refresh, network blip, tab close) must not cancel the
    // turn — only an explicit /chat/cancel does. This handler keeps
    // iterating the generator to completion regardless of `res`'s state, so
    // the turn (and its activeTurn buffering — see AcpAgentSession) keeps
    // running; a reconnecting tab catches up via GET /chat/stream. `detach`
    // marks this connection as no longer watching, arming the idle-turn
    // grace-period reaper if nobody else attaches (see index.ts's
    // getIdleTurnGraceMs()).
    let detach: (() => void) | null = null;
    let attached = false;
    req.on("close", () => detach?.());

    try {
      const gen = session.sendMessage(body.message ?? "", {
        images: (body.images ?? []).map((i) => ({
          data: i.data,
          mimeType: i.mimeType,
          filename: i.filename,
        })),
      });
      for await (const patch of gen) {
        if (!attached) {
          attached = true;
          detach = session.getActiveTurn?.()?.attach(null) ?? null;
        }
        writePatch(patch);
        const pt = (patch as { type?: string }).type;
        if (pt === "done" || pt === "error") break;
      }
      if (!res.writableEnded) res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writePatch({ type: "error", message } as ChatPatch);
      if (!res.writableEnded) res.end();
    }
  }));
```

Note: the old code guaranteed a trailing `{type:"done"}` sentinel via an explicit `res.write` after the loop; that's no longer needed here because `AcpAgentSession.sendMessage` now always yields a `done` patch itself (Task 1), so the loop's own `pt === "done"` break already covers it.

- [ ] **Step 4: Run test to verify it passes**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: PASS for the new test, and no regressions in `"POST /chat/send streams SSE patches and ends with {type:'done'}"` or the usage-caching test.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "fix(server): disconnecting from /chat/send no longer cancels the turn"
```

---

### Task 4: `GET /chat/stream` reattach endpoint

**Files:**
- Modify: `src/server.ts` (new route, add near `/chat/send`)
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes: `session.getActiveTurn?.()` (Task 1/2), `ActiveTurnHandle.attach` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `src/server.test.ts`:

```ts
test("GET /chat/stream replays buffered patches then continues live, and 404s once the turn is gone", async () => {
  const sessionId = "sess-reattach-1";
  await withServer(async (ws) => {
    const backend = new FakeBackend({
      initialSessionId: sessionId,
      initialSessionPatches: [
        { type: "text-delta", index: 0, delta: "a" },
        { type: "text-delta", index: 0, delta: "b" },
        { type: "text-delta", index: 0, delta: "c" },
        { type: "done" },
      ],
      patchDelayMs: 40,
    });
    return {
      backend,
      fn: async (url) => {
        // No active turn yet — 404.
        const before = await fetch(`${url}/chat/stream?sessionId=${sessionId}`);
        assert.equal(before.status, 404);

        // Start a turn but don't wait for it to finish.
        const sendPromise = fetch(`${url}/chat/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "hi", sessionId }),
        });
        await new Promise((r) => setTimeout(r, 60)); // let ~1 patch land

        const streamRes = await fetch(`${url}/chat/stream?sessionId=${sessionId}`);
        assert.equal(streamRes.status, 200);
        assert.match(streamRes.headers.get("content-type") ?? "", /text\/event-stream/);
        const text = await streamRes.text();
        const events = text.split("\n\n").filter((s) => s.startsWith("data: ")).map((s) => JSON.parse(s.slice(6)));
        assert.ok(events.length >= 2, "expected buffered + live patches");
        assert.equal(events[events.length - 1].type, "done");

        await sendPromise; // drain the original request too

        // Turn is over now — a fresh reattach 404s again.
        const after = await fetch(`${url}/chat/stream?sessionId=${sessionId}`);
        assert.equal(after.status, 404);
      },
    };
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: FAIL — `404` for the whole test suite since the route doesn't exist (Express falls through to no matching route).

- [ ] **Step 3: Add the route**

In `src/server.ts`, add right after the `/chat/send` route:

```ts
  // ── GET /chat/stream (reattach to an in-flight turn) ──────────────
  app.get("/chat/stream", smallJson, asyncRoute(async (req, res) => {
    const q = StreamQuerySchema.parse(req.query);
    const session = await registry.getSession(q.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const handle = session.getActiveTurn?.();
    if (!handle) {
      res.status(404).json({ error: "no active turn" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const writePatch = (patch: ChatPatch) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(patch)}\n\n`);
      const pt = (patch as { type?: string }).type;
      if (pt === "usage") {
        opts.sessionConfig
          ?.setLastUsage(q.sessionId, (patch as { usage: UsageTotals }).usage)
          .catch(() => {});
      }
      if ((pt === "done" || pt === "error") && !res.writableEnded) res.end();
    };
    // No await between the snapshot and attach() below — single-threaded JS
    // guarantees no patch can arrive and be missed in that gap.
    for (const p of handle.patches) writePatch(p);
    const detach = handle.attach(writePatch);
    req.on("close", () => detach());
  }));
```

Add the schema near the other `z.object(...)` definitions:

```ts
const StreamQuerySchema = z.object({ sessionId: z.string() });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat(server): add GET /chat/stream to reattach to an in-flight turn"
```

---

### Task 5: `GET /chat/init` — skip `loadSession()` when a turn is already live

**Files:**
- Modify: `src/server.ts` (the `/chat/init` route)
- Modify: `src/agent/types.ts` is not touched here — response shape only
- Test: `src/server.test.ts`

**Interfaces:**
- Produces: `activeTurn: boolean` field on the `/chat/init` JSON response.
- Consumes: `session.getActiveTurn?.()` (Task 1/2), `backend.loadedWithCwd` (existing `FakeBackend` tracking, used for the negative assertion).

- [ ] **Step 1: Write the failing test**

Add to `src/server.test.ts`:

```ts
test("GET /chat/init returns activeTurn:true and skips loadSession while a turn is streaming", async () => {
  const sessionId = "sess-init-active-1";
  await withServer(async (ws) => {
    const backend = new FakeBackend({
      initialSessionId: sessionId,
      initialSessionPatches: [
        { type: "text-delta", index: 0, delta: "a" },
        { type: "text-delta", index: 0, delta: "b" },
        { type: "text-delta", index: 0, delta: "c" },
        { type: "done" },
      ],
      patchDelayMs: 40,
    });
    return {
      backend,
      fn: async (url) => {
        const sendPromise = fetch(`${url}/chat/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "hi", sessionId }),
        });
        await new Promise((r) => setTimeout(r, 60)); // let ~1 patch land

        const initRes = await fetch(`${url}/chat/init?sessionId=${sessionId}`);
        assert.equal(initRes.status, 200);
        const body = (await initRes.json()) as {
          activeTurn: boolean;
          history: Array<{ kind: string; patches?: unknown[] }>;
        };
        assert.equal(body.activeTurn, true);
        const last = body.history[body.history.length - 1];
        assert.equal(last?.kind, "assistant");
        assert.ok((last?.patches?.length ?? 0) >= 1, "in-progress patches should be in history");
        assert.equal(backend.loadedWithCwd.length, 0, "loadSession must not be called while a turn is live");

        await sendPromise;

        const initAfter = await fetch(`${url}/chat/init?sessionId=${sessionId}`);
        const bodyAfter = (await initAfter.json()) as { activeTurn: boolean };
        assert.equal(bodyAfter.activeTurn, false);
        assert.equal(backend.loadedWithCwd.length, 1, "once the turn is over, init falls back to the normal loadSession path");
      },
    };
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: FAIL — `body.activeTurn` is `undefined`, and `loadedWithCwd.length` is `1` (today's code always calls `loadSession`).

- [ ] **Step 3: Update `/chat/init` in `src/server.ts`**

Replace the `if (q.sessionId) { ... }` block (`src/server.ts:65-96`) with:

```ts
    if (q.sessionId) {
      effectiveCwd = requestedCwd ?? opts.sessionConfig?.getSessionCwd(q.sessionId) ?? workspace;
      const owner = await registry.findSession(q.sessionId);
      backend = owner ? owner.backend : await registry.getDefaultBackend(effectiveCwd);
      backendName = owner ? owner.backendName : registry.getDefaultBackendName();
      const resident = owner ? await registry.getSession(q.sessionId) : null;
      const liveTurn = resident?.getActiveTurn?.() ?? null;
      if (liveTurn) {
        // A turn is still streaming in this process — reuse the resident
        // session as-is. Calling loadSession() here would replace its
        // SessionContext and orphan the in-flight turn's patch pump (see
        // docs/acp-notes.md). History is limited to this turn's buffered
        // tail in this branch; prior settled turns aren't replayed here —
        // they were already shown before this reload.
        session = resident!;
        resumed = true;
      } else if (backend.loadSession) {
        session = await backend.loadSession(q.sessionId, { cwd: effectiveCwd });
        resumed = true;
      } else {
        const found = await registry.getSession(q.sessionId);
        if (!found) {
          res.status(404).json({ error: "session not found" });
          return;
        }
        session = found;
        resumed = true;
      }
    } else {
```

(The `else` branch and everything below it is unchanged — only the `if (q.sessionId)` body changes.)

Then, after `const history = session.consumeReplayHistory?.() ?? [];` (`src/server.ts:130`), add:

```ts
    const liveTurnForResponse = session.getActiveTurn?.() ?? null;
    if (liveTurnForResponse && liveTurnForResponse.patches.length > 0) {
      history.push({ kind: "assistant", patches: liveTurnForResponse.patches });
    }
```

And in the `res.json({ ... })` call, add a field:

```ts
      history,
      activeTurn: liveTurnForResponse != null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: PASS, and no regressions in the existing `/chat/init` tests (e.g. `"GET /chat/init respects sessionId in query (resume)"`, the cross-backend-ownership test).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "fix(server): /chat/init skips loadSession while a turn is streaming"
```

---

### Task 6: Frontend `fetchSSE` — support a GET (no-body) stream

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: `fetchSSE<T>(url: string, body: object | null, handlers): SSEHandle` (body `null` ⇒ GET, no body).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/api/client.test.ts`:

```ts
describe("fetchSSE", () => {
  it("sends a plain GET with no body when body is null", async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response("data: " + JSON.stringify({ type: "done" }) + "\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    global.fetch = spy;
    const patches: unknown[] = [];
    const handle = fetchSSE("/chat/stream?sessionId=abc", null, {
      onPatch: (p) => patches.push(p),
    });
    await handle.done;
    expect(spy).toHaveBeenCalledWith(
      "/chat/stream?sessionId=abc",
      expect.objectContaining({ signal: expect.anything() }),
    );
    const callArgs = spy.mock.calls[0][1];
    expect(callArgs.method).toBeUndefined();
    expect(callArgs.body).toBeUndefined();
    expect(patches).toEqual([{ type: "done" }]);
  });
});
```

Add `fetchSSE` to the existing `import { fetchJSON } from "./client";` line (change to `import { fetchJSON, fetchSSE } from "./client";`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: FAIL — `fetchSSE` currently requires a `body: object` (TypeScript would actually fail to compile passing `null`); at minimum the runtime test fails because today's implementation always sends `method: "POST"` with a JSON body.

- [ ] **Step 3: Update `fetchSSE` in `frontend/src/api/client.ts`**

Replace the `fetchSSE` function signature and its `fetch` call:

```ts
export function fetchSSE<T = unknown>(
  url: string,
  body: object | null,
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
      const res = await fetch(
        url,
        body === null
          ? { signal: controller.signal }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            },
      );
```

(Everything below that `fetch(...)` call in the function body is unchanged.)

- [ ] **Step 4: Update the one existing call site's type-only impact**

`frontend/src/state/useChat.ts:62` already calls `fetchSSE<ChatPatch>("/chat/send", { message: text, ... }, {...})` — this still type-checks since a non-null `object` satisfies `object | null`. No code change needed there for this task.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: PASS. Also run: `cd frontend && npx vitest run src/state/useSSE.test.ts src/state/useChat.test.tsx` to confirm no regressions from the signature widening.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): fetchSSE supports a GET stream with no request body"
```

---

### Task 7: Frontend — `activeTurn` in `ChatInitResponse`/`ChatState`

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/state/ChatContext.tsx`
- Test: `frontend/src/state/ChatContext.test.tsx`

**Interfaces:**
- Produces: `ChatInitResponse.activeTurn: boolean`, `ChatState.activeTurn: boolean`.
- Consumes: nothing new (mirrors the backend field added in Task 5).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/state/ChatContext.test.tsx`, near `"init sets session + cwd + capabilities"`:

```ts
  it("init copies activeTurn from the server response into state", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: { ...baseInit, activeTurn: true } });
    const { result } = renderHook(() => useChatContext(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.activeTurn).toBe(true);
  });

  it("init defaults activeTurn to false when the server omits it", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const { result } = renderHook(() => useChatContext(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.activeTurn).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/state/ChatContext.test.tsx`
Expected: FAIL — TypeScript error (`activeTurn` doesn't exist on `ChatInitResponse`/spread override) or `undefined !== true`.

- [ ] **Step 3: Add the field**

In `frontend/src/api/types.ts`, add to `ChatInitResponse` (after `model: { ... };`):

```ts
  activeTurn: boolean;
```

In `frontend/src/state/ChatContext.tsx`:
- Add `activeTurn: boolean;` to `ChatState` (after `resumed: boolean;`).
- Add `activeTurn: false,` to `INITIAL`.
- In `init()`'s success branch (inside the `setState((s) => {...})` object), add `activeTurn: d.activeTurn ?? false,` (after `resumed: d.resumed,`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/state/ChatContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/state/ChatContext.tsx frontend/src/state/ChatContext.test.tsx
git commit -m "feat(frontend): thread activeTurn through ChatInitResponse and ChatState"
```

---

### Task 8: Frontend `useChat.ts` — reattach to a live turn on mount

**Files:**
- Modify: `frontend/src/state/useChat.ts`
- Test: `frontend/src/state/useChat.test.tsx`

**Interfaces:**
- Consumes: `ctx.state.activeTurn` (Task 7), `fetchSSE(url, null, handlers)` (Task 6).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/state/useChat.test.tsx`:

```ts
  it("reattaches to a live turn via GET /chat/stream when init reports activeTurn", async () => {
    fetchJSONSpy.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ...baseInit,
        activeTurn: true,
        history: [
          { kind: "user", content: "hello" },
          { kind: "assistant", patches: [{ type: "text-delta", index: 0, delta: "partial" }] },
        ],
      },
    });
    const patches: ChatPatch[] = [
      { type: "text-delta", index: 0, delta: " more" },
      { type: "done" },
    ];
    let capturedUrl = "";
    let capturedBody: unknown;
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockImplementation((url, body, handlers) => {
      capturedUrl = url;
      capturedBody = body;
      Promise.resolve().then(() => {
        for (const p of patches) handlers.onPatch(p);
        handlers.onDone?.();
      });
      return { abort: vi.fn(), done: Promise.resolve() };
    });

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init("sess-1"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(capturedUrl).toBe("/chat/stream?sessionId=sess-1");
    expect(capturedBody).toBeNull();
    expect(result.current.transcript).toHaveLength(2);
    expect(result.current.transcript[1].role).toBe("assistant");
    if (result.current.transcript[1].role === "assistant") {
      expect(result.current.transcript[1].patches).toHaveLength(3); // 1 from history + 2 reattached
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/state/useChat.test.tsx`
Expected: FAIL — `capturedUrl` stays `""` (nothing calls `fetchSSE` on init today).

- [ ] **Step 3: Add the reattach effect to `frontend/src/state/useChat.ts`**

Add `useEffect` to the existing import (`import { useCallback, useEffect, useRef, useState } from "react";` — already imports `useEffect`, no change needed there).

Add, right after the existing history-sync `useEffect` (`useChat.ts:48-50`):

```ts
  useEffect(() => {
    if (!ctx.state.sessionId || !ctx.state.activeTurn) return;
    ctx.setBusy(true);
    sseRef.current?.abort();
    sseRef.current = fetchSSE<ChatPatch>(
      `/chat/stream?sessionId=${encodeURIComponent(ctx.state.sessionId)}`,
      null,
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
        onError: () => { ctx.setBusy(false); sseRef.current = null; },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.state.sessionId, ctx.state.activeTurn]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/state/useChat.test.tsx`
Expected: PASS, with no regressions in the other `useChat` tests (`"sendMessage collects patches into transcript"`, `"cancel aborts the stream"`).

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npm run test:web`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/state/useChat.ts frontend/src/state/useChat.test.tsx
git commit -m "feat(frontend): reattach to a live turn on reload via GET /chat/stream"
```

---

## Post-plan verification

After all 8 tasks:

- [ ] Run `npm run typecheck` (repo root) — expect PASS.
- [ ] Run `npm test` (repo root) — expect all backend tests PASS.
- [ ] Run `cd frontend && npm run test:web` — expect all frontend tests PASS.
- [ ] Manual smoke test (per the project's `run`/`verify` skills): start the gateway and frontend, send a long-running prompt, refresh the tab mid-stream, and confirm the response keeps appearing instead of stopping or duplicating.
