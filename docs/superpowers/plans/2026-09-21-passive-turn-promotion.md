# Passive Turn Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a session that is busy inside the agent backend but has no gateway-owned turn, and stream its live output to a refreshed tab.

**Architecture:** In `AcpAgentSession.handleSessionUpdate`, when an incoming `session/update` is a message-part update that is neither replay capture nor part of a tracked turn, promote a **passive** `activeTurn` (same shape as the send-origin turn, but `origin: "passive"`) and buffer every patch into it. `loadSession()` gains a `passiveProbeMs` window that waits (race, not sleep) for that promotion right after replay drains, so `GET /chat/init` can report `activeTurn: true` and the existing `/chat/stream` reattach path replays the buffered tail. Passive turns retire (synthesizing `done` to any attached viewer) after `getIdleTurnGraceMs()` of quiet and are exempt from the idle cancel reaper.

**Tech Stack:** TypeScript (Node, `node:test` + `assert`), Express server, ACP JSON-RPC subprocess fixture (`fake-streaming-agent.cjs`), `ws`/xterm frontend (untouched).

**Spec:** `docs/superpowers/specs/2026-09-21-passive-turn-promotion-design.md`

---

## File structure

- **`test/fixtures/fake-streaming-agent.cjs`** — gains `X_FAKE_AGENT_AFTER_LOAD_UPDATES` (with `__delayMs` quiet-gap sentinels) and `X_FAKE_AGENT_AFTER_LOAD_DELAY_MS`; emits the updates to the gateway right after a `session/load` reply (Task 1).
- **`src/agent/types.ts`** — `CreateSessionOptions` gains `passiveProbeMs?: number` (Task 2).
- **`src/agent/acp/index.ts`** — the promotion/retirement core: SessionContext fields, `waitForPassiveTurn`, `clearPassiveTurnTimers`, `isMessagePartUpdate`, `promotePassiveTurn`, `armPassiveGrace`, `retirePassiveTurn`, probe in `loadSession`, detach guard in `getActiveTurn`, cleanup in `close()` (Tasks 2–4).
- **`src/server.ts`** — `getPassiveTurnProbeMs()` env helper; `/chat/init` resume passes `passiveProbeMs` to `loadSession` and skips model/config re-apply while a passive turn is live (Task 5).
- **`src/agent/acp/index.test.ts`** — unit tests for the AcpAgentSession behaviors (Tasks 2, 3, 4).
- **`src/server.test.ts`** — probe-disabled default guard + quiet-backend bounded-probe test (Task 5); real-subprocess end-to-end busy test (Task 6).
- **`docs/superpowers/specs/2026-09-21-passive-turn-promotion-design.md`** — parenthetical correction (Task 3), Status flip to implemented (Task 7).

Commands used throughout (from `AGENTS.md`):

- One unit test file: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
- One named test: append `--test-name-pattern="<substring>"` (e.g. `--test-name-pattern="passive"`).
- Server tests: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
- Typecheck gate: `npm run typecheck`

---

### Task 1: Fixture — after-load live updates

**Files:**
- Modify: `test/fixtures/fake-streaming-agent.cjs`

Goal: let the fake agent emit *live* `session/update` notifications a moment after a `session/load` reply, distinct from the replay burst. These are the "backend is busy in a session jarvis didn't start" updates the promotion rule will consume.

- [ ] **Step 1: Add the env-vars + emission to the fixture**

In `test/fixtures/fake-streaming-agent.cjs`:

- Extend the header comment block (currently lines ~4–54, near the other `X_FAKE_AGENT_*` docs) with:

```
//   X_FAKE_AGENT_AFTER_LOAD_UPDATES — JSON array of session/update `update`
//                            bodies emitted as notifications AFTER the
//                            session/load reply (the "backend is busy in a
//                            session jarvis didn't start" signal). Entries may
//                            be { "__delayMs": <n> } sentinels to insert a
//                            quiet gap mid-burst (so a later burst provably
//                            promotes a fresh turn).
//   X_FAKE_AGENT_AFTER_LOAD_DELAY_MS — ms to wait after the session/load reply
//                            before emitting the burst (default 200). Keep it
//                            well above the gateway's ~75ms replay-drain window
//                            so the burst is NOT mistaken for replay capture.
```

- After the existing `replayUpdates` parse (currently lines ~143–149), add:

```js
  const rawAfterLoad = process.env.X_FAKE_AGENT_AFTER_LOAD_UPDATES;
  let afterLoadUpdates = [];
  if (rawAfterLoad) {
    try {
      afterLoadUpdates = JSON.parse(rawAfterLoad);
    } catch (err) {
      console.error("bad X_FAKE_AGENT_AFTER_LOAD_UPDATES", err);
    }
  }
  const afterLoadDelayMs = parseInt(process.env.X_FAKE_AGENT_AFTER_LOAD_DELAY_MS || "200", 10);
```

- Add an emitter function next to `chunkDelay` (currently line ~203):

```js
async function emitAfterLoadUpdates(sid) {
  await chunkDelay(afterLoadDelayMs);
  for (const entry of afterLoadUpdates) {
    if (entry && typeof entry === "object" && "__delayMs" in entry) {
      await chunkDelay(entry.__delayMs);
      continue;
    }
    emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: sid, update: entry },
    });
    await chunkDelay(15);
  }
}
```

- In the `session/load` handler (currently lines ~377–394), kick the burst off right after the reply (so the ordering mirrors a real agent that keeps emitting after its load result):

```js
      reply(msg.id, claudeStyleConfig
        ? { sessionId: sid, modes, configOptions }
        : { sessionId: sid, configOptions });
      if (afterLoadUpdates.length > 0) {
        void emitAfterLoadUpdates(sid);
      }
      break;
```

- [ ] **Step 2: Verify emission ordering with a raw stdio probe**

No test-server involved yet — just replay the fixture's stdio on a pipe. Expected: the `id:1` result line for `session/load` prints FIRST, then the `session/update` notification line prints later.

Run:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"session/load","params":{"sessionId":"probe-sess"}}\n' \
  | X_FAKE_AGENT_AFTER_LOAD_UPDATES='[{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"tail"}}]' \
    X_FAKE_AGENT_AFTER_LOAD_DELAY_MS='50' node test/fixtures/fake-streaming-agent.cjs
```

Expected output: a line `{"jsonrpc":"2.0","id":1,"result":{...}}` followed later by a line `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"probe-sess","update":{"sessionUpdate":"agent_message_chunk",...}}}`.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/fake-streaming-agent.cjs
git commit -m "test(fixtures): after-load live updates in fake-streaming-agent"
```

---

### Task 2: Options plumbing — `passiveProbeMs` through `loadSession`

**Files:**
- Modify: `src/agent/types.ts:63-66`
- Modify: `src/agent/acp/index.ts` (SessionContext ~66–97, makeSessionContext ~823–856, loadSession 452–493, sendMessage turn literal ~1009, module helpers near `getIdleTurnGraceMs` ~942)
- Test: `src/agent/acp/index.test.ts`

Goal: thread a `passiveProbeMs` option into `loadSession`, add the module-level probe/cleanup helpers the next tasks use, and prove the probe window on a quiet session is a bounded no-op.

- [ ] **Step 1: Write the failing test**

Append to the loadSession test block in `src/agent/acp/index.test.ts` (near the existing "usage_update replayed mid-history" test, ~line 261):

```ts
test("loadSession with passiveProbeMs on a quiet session waits the probe then returns without promoting a turn", async () => {
  const backend = await newBackend({});
  try {
    const started = Date.now();
    const session = await backend.loadSession("sid", { cwd: process.cwd(), passiveProbeMs: 150 }) as AcpAgentSession;
    assert.ok(Date.now() - started >= 150, "the probe should wait out its full window on a quiet session");
    assert.equal(session.getActiveTurn(), null, "no promotion on a quiet session");
  } finally {
    await backend.shutdown();
  }
});
```

`sid` is not pre-seeded in the fixture — the fake agent's `session/load` accepts any id and replies, which is the existing pattern the replay tests already rely on.

- [ ] **Step 2: Run the test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern="quiet session" src/agent/acp/index.test.ts`
Expected: FAIL with `TypeError: opts.passiveProbeMs not accepted` — actually a compile error `acpUpdateToPatches`-free path; concretely `loadSession`'s options type has no `passiveProbeMs`, so ts-node surfaces a TS error (`Object literal may only specify known properties`).

- [ ] **Step 3: Implement — types + helpers + probe**

**`src/agent/types.ts`** — add the option:

```ts
export interface CreateSessionOptions {
  cwd?: string;
  label?: string;
  passiveProbeMs?: number;
}
```

**`src/agent/acp/index.ts`** — `SessionContext` gains the waiter slot:

```ts
  activeTurn: {
    patches: ChatPatch[];
    viewerCallback: ((patch: ChatPatch) => void) | null;
    viewerToken: unknown;
    idleTimer: NodeJS.Timeout | null;
    origin: "send" | "passive";
    graceTimer: NodeJS.Timeout | null;
  } | null;
  passiveTurnWaiter: (() => void) | null;
```

In `makeSessionContext` (line ~854) set `activeTurn: null` and add `passiveTurnWaiter: null` to the returned object.

In `sendMessage`, the activeTurn literal planted at turn start (currently ~line 1009) must match the shape:

```ts
      activeTurn: {
        patches: [],
        viewerCallback: null,
        viewerToken: null,
        idleTimer: null,
        origin: "send",
        graceTimer: null,
      },
```

Add module-level helpers next to `getIdleTurnGraceMs` (~line 946):

```ts
function clearPassiveTurnTimers(ctx: SessionContext): void {
  if (ctx.activeTurn?.idleTimer) clearTimeout(ctx.activeTurn.idleTimer);
  if (ctx.activeTurn?.graceTimer) clearTimeout(ctx.activeTurn.graceTimer);
  ctx.onPatch = null;
  ctx.activeTurn = null;
  ctx.passiveTurnWaiter = null;
  ctx.busy = false;
}

function waitForPassiveTurn(ctx: SessionContext, timeoutMs: number): Promise<void> {
  if (ctx.activeTurn) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ctx.passiveTurnWaiter = null;
      resolve();
    }, timeoutMs);
    ctx.passiveTurnWaiter = () => {
      clearTimeout(timer);
      ctx.passiveTurnWaiter = null;
      resolve();
    };
  });
}
```

`clearPassiveTurnTimers` is only wired up how the next tasks need it; it is referenced now so the file compiles, but this task keeps it internal (attachment sites land in Tasks 3–4).

**`loadSession`** — the cleanup + probe both go in:

- Right **before** `this.sessions.set(sessionId, ctx);` (line ~464) add:

```ts
    // If a previous load's probe promoted a live passive turn, that turn owns
    // the old ctx. Replace it cleanly so a still-ticking grace/idle timer can't
    // fire against the swapped-out context (the retire path identity-guards
    // anyway; this just avoids holding the drains open).
    const prev = this.sessions.get(sessionId);
    if (prev) clearPassiveTurnTimers(prev);
```

- After `ctx.captureReplay = false;` (line ~491), before `return sessionObj;`, add:

```ts
    // Probe: wait briefly for the backend to confirm this session is busy — an
    // update that is NOT part of the replay (a promotion in handleSessionUpdate,
    // wired in the next task) resolves this early; a quietly idle session blocks
    // the INIT for the full window and then proceeds as normal.
    if (opts?.passiveProbeMs) {
      await waitForPassiveTurn(ctx, opts.passiveProbeMs);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern="quiet session" src/agent/acp/index.test.ts`
Expected: PASS. Then `npm run typecheck` — must be clean.

- [ ] **Step 5: Commit**

```bash
git add src/agent/types.ts src/agent/acp/index.ts src/agent/acp/index.test.ts
git commit -m "feat(acp): wire passive-turn probe option through loadSession"
```

---

### Task 3: Promotion rule + `handleSessionUpdate` promotion

**Files:**
- Modify: `src/agent/acp/index.ts` (handleSessionUpdate ~269–292, module helpers near `getIdleTurnGraceMs`)
- Test: `src/agent/acp/index.test.ts`
- Modify: `docs/superpowers/specs/2026-09-21-passive-turn-promotion-design.md` (parenthetical ~58–60)

Goal: the core rule — a message-part update that is neither replay capture nor part of a tracked turn promotes a passive `activeTurn` that buffers the patch. And correct the spec's parenthetical (which wrongly lists `session/request_permission` as a promotion kind).

- [ ] **Step 1: Correct the spec parenthetical**

`docs/superpowers/specs/2026-09-21-passive-turn-promotion-design.md` lines ~58–60. Replace:

```
> > (`agent_message_chunk`, `user_message_chunk`, `tool_call*`, `agent_thought_chunk`,
> > `session/request_permission`, etc.)
```

with:

```
> > (`agent_message_chunk`, `user_message_chunk`, `tool_call`, `tool_call_update`,
> > `agent_thought_chunk`)
```

and immediately after the blockquote add:

```
> `session/request_permission` is NOT a promotion trigger: it arrives on the
> `onRequest` channel (src/agent/acp/jsonrpc.ts) and is routed by
> `routeApprovalToUI`, riding the same viewer path as a gateway turn once a
> passive turn's `onPatch` router is installed.
```

- [ ] **Step 2: Write the failing tests**

Append to the `src/agent/acp/index.test.ts` describe block that holds `loadSession` tests (after the Task 2 test):

```ts
test("loadSession promotes a passive activeTurn while the backend is busy and buffers the live tail", async () => {
  process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS = String(60 * 1000);
  const backend = await newBackend({
    X_FAKE_AGENT_AFTER_LOAD_UPDATES: JSON.stringify([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "one " } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "two " } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "three" } },
    ]),
  });
  try {
    const session = await backend.loadSession("busy-sid", { cwd: process.cwd(), passiveProbeMs: 5000 }) as AcpAgentSession;
    // The probe resolves on the FIRST promoting chunk; let the rest of the
    // burst land before snapshotting the buffer.
    await new Promise((r) => setTimeout(r, 120));
    const turn = session.getActiveTurn();
    assert.ok(turn, "a busy backend should promote a passive activeTurn during the probe");
    const text = turn!.patches
      .filter((p): p is { type: "text-delta"; delta: string } => p.type === "text-delta")
      .filter((p) => typeof p.delta === "string")
      .map((p) => p.delta)
      .join("");
    assert.equal(text, "one two three");
  } finally {
    delete process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
    await backend.shutdown();
  }
});

test("passive promotion does not fire for replay-captured updates", async () => {
  const backend = await newBackend({
    X_FAKE_AGENT_REPLAY_UPDATES: JSON.stringify([
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: "hi" } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    ]),
  });
  try {
    const session = await backend.loadSession("replay-sid", { cwd: process.cwd(), passiveProbeMs: 300 }) as AcpAgentSession;
    assert.equal(session.getActiveTurn(), null, "replay updates must not promote a passive turn");
    const history = session.consumeReplayHistory();
    assert.ok(history.some((e) => e.kind === "user"), "replay should still reconstruct history");
    assert.ok(history.some((e) => e.kind === "assistant"), "replay should still reconstruct the assistant entry");
  } finally {
    await backend.shutdown();
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern="passive" src/agent/acp/index.test.ts`
Expected: the busy test FAILS (`turn` is null — no promotion exists yet); the replay test PASSES today but must stay passing after the change (it is the guard against promoting mid-replay, which the up-next implementation must preserve).

- [ ] **Step 4: Implement — whitelist + promotion + router**

Add module helpers next to `getIdleTurnGraceMs` (~line 946):

```ts
const MESSAGE_PART_UPDATE_KINDS = new Set([
  "agent_message_chunk",
  "agent_thought_chunk",
  "user_message_chunk",
  "tool_call",
  "tool_call_update",
]);

function isMessagePartUpdate(update: AcpUpdate): boolean {
  return MESSAGE_PART_UPDATE_KINDS.has(update.sessionUpdate);
}

function promotePassiveTurn(ctx: SessionContext): void {
  ctx.busy = true;
  resetTurnState(ctx.state);
  const turn = {
    patches: [] as ChatPatch[],
    viewerCallback: null as ((patch: ChatPatch) => void) | null,
    viewerToken: null as unknown,
    idleTimer: null as NodeJS.Timeout | null,
    origin: "passive" as const,
    graceTimer: null as NodeJS.Timeout | null,
  };
  ctx.activeTurn = turn;
  ctx.onPatch = (patches) => {
    for (const patch of patches) {
      turn.patches.push(patch);
      turn.viewerCallback?.(patch);
    }
    armPassiveGrace(ctx, turn);
  };
  armPassiveGrace(ctx, turn);
  const waiter = ctx.passiveTurnWaiter;
  ctx.passiveTurnWaiter = null;
  waiter?.();
}
```

`armPassiveGrace` is defined in Task 4 — for this task add a stub that satisfies compilation and the busy test (grace timer only matters for retirement, which Task 4 wires):

```ts
function armPassiveGrace(ctx: SessionContext, turn: NonNullable<SessionContext["activeTurn"]>): void {
  // Retirement (grace timer → synthesized done) is wired in the next task; the
  // probe path only needs the turn to exist and buffer.
  void ctx;
  void turn;
}
```

In `handleSessionUpdate` (index.ts ~line 280, right after `const ctx = this.sessions.get(sid); if (!ctx) return;`) insert the promotion check — **BEFORE** `acpUpdateToPatches`, because that call mutates `ctx.state` and promotion resets turn indices to 0 (same as `sendMessage`):

```ts
    // Passive turn promotion: a message-part update that is neither replay
    // capture nor a tracked turn means the backend is busy in a session jarvis
    // didn't start (external CLI turn, gateway restart mid-turn, post-done
    // continuation). Promote a passive activeTurn so this update stream buffers
    // instead of being silently dropped, and a refresh can attach to it.
    if (!ctx.captureReplay && !ctx.activeTurn && isMessagePartUpdate(update)) {
      promotePassiveTurn(ctx);
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern="passive" src/agent/acp/index.test.ts`
Expected: both PASS. Then run the full file `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts` — no regressions — and `npm run typecheck`.

Note: `request_permission`-during-passive-turn routing needs no new test: it already flows through `routeApprovalToUI` → `ctx.onPatch`, which the new passive router satisfies; the existing approval tests cover the mechanism.

- [ ] **Step 6: Commit**

```bash
git add src/agent/acp/index.ts src/agent/acp/index.test.ts docs/superpowers/specs/2026-09-21-passive-turn-promotion-design.md
git commit -m "feat(acp): promote passive turns for backend-busy sessions (probe + buffer)"
```

---

### Task 4: Turn-end — quiet-grace retirement + reaper exemption + close cleanup

**Files:**
- Modify: `src/agent/acp/index.ts` (getActiveTurn detach ~1107–1114, close ~1166–1178, module helpers)
- Test: `src/agent/acp/index.test.ts`

Goal: a passive turn synthesizes `done` and retires after `getIdleTurnGraceMs()` quiet; the idle reaper never cancels a passive turn; `close()` clears passive timers.

- [ ] **Step 1: Write the failing tests**

Append to the `src/agent/acp/index.test.ts` getActiveTurn describe block (near the existing reaper tests ~line 584):

```ts
test("a passive turn synthesizes done and retires after a quiet window, then a later update promotes fresh", async () => {
  process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS = "100";
  const backend = await newBackend({
    X_FAKE_AGENT_AFTER_LOAD_UPDATES: JSON.stringify([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "one " } },
      { __delayMs: 400 },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "two " } },
    ]),
  });
  try {
    const session = await backend.loadSession("retire-sid", { cwd: process.cwd(), passiveProbeMs: 5000 }) as AcpAgentSession;

    const seenTurns: string[] = [];
    const doneEvents: ChatPatch[] = [];
    const deadline = Date.now() + 2500;
    // Poll: attach to whichever passive turn is live now. Attach is
    // token-guarded, so re-attaching on each tick just swaps the viewer; each
    // retirement delivers its synthetic done to the current viewer.
    while (Date.now() < deadline) {
      const handle = session.getActiveTurn();
      if (handle) {
        const text = handle.patches
          .filter((p): p is { type: "text-delta"; delta: string } => p.type === "text-delta")
          .filter((p) => typeof p.delta === "string")
          .map((p) => p.delta)
          .join("");
        if (text.includes("one") && !seenTurns.includes("one")) seenTurns.push("one");
        if (text.includes("two") && !seenTurns.includes("two")) seenTurns.push("two");
        handle.attach((p) => doneEvents.push(p));
      }
      if (doneEvents.filter((p) => p.type === "done").length >= 2 && seenTurns.length >= 2) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.deepEqual(seenTurns, ["one", "two"], "both bursts must promote separate passive turns");
    assert.equal(doneEvents.filter((p) => p.type === "done").length, 2, "each quiet retirement must synthesize done");
    assert.equal(session.getActiveTurn(), null, "after all quiet, the passive turn must be retired");
  } finally {
    delete process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
    await backend.shutdown();
  }
});

test("the idle reaper never cancels a passive turn", async () => {
  const eventLogFile = path.join(os.tmpdir(), `evlog-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS = "50";
  const backend = await newBackend({
    X_FAKE_AGENT_AFTER_LOAD_UPDATES: JSON.stringify([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    ]),
    X_FAKE_AGENT_EVENT_LOG_FILE: eventLogFile,
  });
  try {
    const session = await backend.loadSession("reaper-sid", { cwd: process.cwd(), passiveProbeMs: 5000 }) as AcpAgentSession;
    const handle = session.getActiveTurn();
    assert.ok(handle, "passive turn should be promoted");
    // For a send-origin turn, attach-then-detach arms the cancel reaper. It
    // must be a no-op for passive turns.
    const detach = handle!.attach(() => {});
    detach();
    await new Promise((r) => setTimeout(r, 300)); // past the grace several times over
    const log = fs.existsSync(eventLogFile)
      ? fs.readFileSync(eventLogFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.ok(
      !log.some((e: { method: string }) => e.method === "session/cancel"),
      "passive turns must never be auto-cancelled by the idle reaper",
    );
    assert.equal(session.getActiveTurn(), null, "the turn should still retire peacefully after quiet");
  } finally {
    delete process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
    await backend.shutdown();
    fs.rmSync(eventLogFile, { force: true });
  }
});
```

These must NOT use `t.mock.timers` — `loadSession`'s `waitForReplayIdle` awaits a mocked `setTimeout` and would hang forever; real timers with the grace env knob are required.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern="passive" src/agent/acp/index.test.ts`
Expected: both FAIL — the retire loop never gets two `done` events (no retirement), and `getActiveTurn()` never returns null (no retirement). Note the second test may fail at "passive turn should be promoted" — no wait, it will fail at the `assert.equal(session.getActiveTurn(), null, ...)` because with the Task 3 stub `armPassiveGrace` nothing ever retires.

- [ ] **Step 3: Implement — retirement + detach guard + close cleanup**

Replace the `armPassiveGrace` stub from Task 3 with the real implementation, and add `retirePassiveTurn`:

```ts
function armPassiveGrace(ctx: SessionContext, turn: NonNullable<SessionContext["activeTurn"]>): void {
  if (turn.origin !== "passive") return;
  if (turn.graceTimer) clearTimeout(turn.graceTimer);
  turn.graceTimer = setTimeout(() => retirePassiveTurn(ctx, turn), getIdleTurnGraceMs());
}

function retirePassiveTurn(ctx: SessionContext, turn: NonNullable<SessionContext["activeTurn"]>): void {
  if (ctx.activeTurn !== turn) return;
  if (turn.graceTimer) clearTimeout(turn.graceTimer);
  turn.graceTimer = null;
  // The spec's "quiet ≠ done": completion is only ever approximated here by a
  // quiet window. Synthesize done to whatever viewer is attached so /chat/stream
  // closes, then retire.
  turn.viewerCallback?.({ type: "done" } as unknown as ChatPatch);
  ctx.onPatch = null;
  ctx.activeTurn = null;
  ctx.busy = false;
}
```

In `getActiveTurn`'s detach closure (currently ~line 1107–1114), exempt passive turns from the cancel reaper:

```ts
        return () => {
          if (at.viewerToken !== token) return;
          at.viewerCallback = null;
          at.viewerToken = null;
          if (at.origin === "passive") return; // passive turns are never auto-cancelled
          at.idleTimer = setTimeout(() => {
            void this.cancel();
          }, getIdleTurnGraceMs());
        };
```

In `close()` (~line 1172), replace `this.ctx.onPatch = null;` with a full teardown:

```ts
    clearPassiveTurnTimers(this.ctx);
```

(`clearPassiveTurnTimers` — added in Task 2 — also nulls `onPatch`, so the shutdown/delete path now drains pending passive timers too.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern="passive" src/agent/acp/index.test.ts`
Expected: both PASS. Then full file + `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/agent/acp/index.ts src/agent/acp/index.test.ts
git commit -m "feat(acp): retire passive turns on quiet grace, exempt from idle reaper"
```

---

### Task 5: Server wiring — probe on `/chat/init` resume, gate config re-apply

**Files:**
- Modify: `src/server.ts` (`/chat/init` resume ~121–160, module-scope helper)
- Test: `src/server.test.ts` (guard + quiet-probe test)

Goal: `/chat/init` resume passes `passiveProbeMs` into `loadSession`; the probe defaults to ~1s and is disableable via env; model/config re-apply is skipped for a session that came back busy with a live passive turn; the server test suite defaults the probe OFF so the existing tests stay fast.

- [ ] **Step 1: Write the failing test (quiet backend, bounded probe)**

Add to `src/server.test.ts` (after the existing resume tests ~line 984):

```ts
test("GET /chat/init resumes quietly when no live update arrives during the probe window", async () => {
  const probe = process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS;
  process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS = "150";
  const sessionId = "sess-quiet-probe";
  try {
    await withServer(async (ws) => ({
      backend: new FakeBackend({ initialSessionId: sessionId, loadableSessions: { [sessionId]: ws } }),
      fn: async (url) => {
        const res = await fetch(`${url}/chat/init?sessionId=${sessionId}`);
        assert.equal(res.status, 200);
        const body = (await res.json()) as { activeTurn: boolean; resumed: boolean };
        assert.equal(body.resumed, true);
        assert.equal(body.activeTurn, false, "a quiet backend must not be reported active");
      },
    }));
  } finally {
    if (probe === undefined) delete process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS;
    else process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS = probe;
  }
});
```

(If the env is not yet wired, `backend.loadSession(sessionId, { cwd })` receives no probe and the test would pass spuriously — so add the gate assertion below and, in Step 2, first run it against a server.ts that has NOT yet been changed to confirm it still passes and mark this task accordingly; the REAL regression guard is the +1s timeout, which we don't wait for here. To make the test meaningfully fail pre-implementation, we rely on Step 3's assertion that the probe actually happened: after the fix, this test passes; before the fix it also passes fast. Therefore the discriminating new test is the default-1s one — see the note in Step 3 — plus the fast-suite guard below.)

- [ ] **Step 2: Add the probe-disabled default for the existing suite**

In `src/server.test.ts`, add file-level `beforeEach`/`afterEach` so every existing `withServer` test skips the probe (otherwise each `/chat/init` slowly waits the ~1s default):

```ts
beforeEach(() => {
  process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS = "0";
});
afterEach(() => {
  delete process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS;
});
```

Place these at the top of the file with the other imports/setup. Run the full server suite: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts` — it must stay green and not gain ~1s per init test.

- [ ] **Step 3: Implement `getPassiveTurnProbeMs` + init wiring + config gate**

**`src/server.ts`** — add at module scope (near `InitQuerySchema`/other top-level helpers):

```ts
function getPassiveTurnProbeMs(): number {
  const raw = process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}
```

In the `/chat/init` resume branch, change the `loadSession` call (currently line ~124):

```ts
          session = await backend.loadSession(q.sessionId, { cwd: effectiveCwd, passiveProbeMs: getPassiveTurnProbeMs() });
```

Then wrap the storedModel / storedConfig re-apply (currently lines ~141–160) so it is skipped while a passive turn is live:

```ts
        const storedModel = opts.sessionConfig?.getModelOverride(q.sessionId);
        const storedConfig = opts.sessionConfig?.getConfigOverrides(q.sessionId) ?? {};
        if (!session.getActiveTurn?.()) {
          // A passive turn was promoted during the probe — the agent is busy in
          // this session. Re-applying model/config into a streaming passive turn
          // is the same hazard loadSession used to have (see docs/acp-notes.md),
          // so leave the running turn alone.
          console.log(`[INIT]   storedModel=${storedModel ?? "(none)"}`);
          if (storedModel) {
            try {
              await backend.setSessionModel?.(q.sessionId, storedModel);
              console.log(`[INIT]   re-applied model ${storedModel}`);
            } catch (e) {
              console.log(`[INIT]   re-apply failed: ${e instanceof Error ? e.message : e}`);
            }
          }
          // Best-effort by design: a stale override for an option the agent no
          // longer reports must not fail the resume.
          for (const [configId, value] of Object.entries(storedConfig)) {
            try {
              await backend.setSessionConfigOption?.(q.sessionId, configId, value);
            } catch (e) {
              console.log(`[INIT]   re-apply ${configId}=${value} failed: ${e instanceof Error ? e.message : e}`);
            }
          }
        }
```

**Discriminating check:** temporarily run `GET /chat/init?sessionId=S` (the Task 6-style real-subprocess setup is in the next task) with the probe env unset on a quiet resume and confirm it takes ~1s; with the env now honored, the Task 6 busy test asserts `activeTurn: true` — the probe being wired is what makes promotion visible to the server, and the quiet test in Step 1 pins the bounded-no-op behavior.

- [ ] **Step 4: Verify**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern="probe" src/server.test.ts` (the Step 1 test) — PASS. Run the full server suite and `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat(server): probe passive turn on /chat/init resume; gate config reapply"
```

---

### Task 6: End-to-end — busy resume streams the buffered tail, and a fast-path refresh skips reload

**Files:**
- Test: `src/server.test.ts` (new test; uses the real fake-agent subprocess + manual `listen`, pattern from the `resolveSessionCwd`/session-ownership tests ~lines 1225–1314 and the manual-server tests ~lines 900–951)

Goal: with a real agent subprocess, a session that goes busy *after* init promotes a passive turn; the refresh-init reports `activeTurn: true`; `/chat/stream` replays the buffered tail then closes on the synthesized `done`; and a second refresh while the turn is still alive takes the resident fast-path (no second `session/load`).

- [ ] **Step 1: Write the failing test**

Append to `src/server.test.ts`:

```ts
test("GET /chat/init promotes a passive turn for a backend-busy session; /chat/stream replays the buffered tail then done; a fast-path refresh skips reload", async () => {
  const ws = await mkWorkspace();
  const probe = process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS;
  const grace = process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
  const eventLogFile = path.join(os.tmpdir(), `evlog-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS = "2000";
  process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS = "500";
  let server: import("node:http").Server | undefined;
  let registry: import("./agent/backendRegistry").BackendRegistry | undefined;
  try {
    const settings = await createSettingsStore({
      path: path.join(ws, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode"],
    });
    const profiles: BackendProfile[] = [
      {
        name: "opencode",
        kind: "opencode",
        command: process.execPath,
        args: [FAKE_AGENT],
        env: {
          X_FAKE_AGENT_AFTER_LOAD_UPDATES: JSON.stringify([
            { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "one " } },
            { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "two " } },
            { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "three" } },
          ]),
          X_FAKE_AGENT_EVENT_LOG_FILE: eventLogFile,
        },
      },
    ];
    registry = await createBackendRegistry({ profiles, settings, workspace: ws, autoApprove: false });
    const sessionConfig = await createSessionConfigStore({ path: path.join(ws, "session_metadata.json"), envDefault: false });
    const tools = createToolRegistry(ws);
    const app = createServer({ workspace: ws, port: 0, registry, tools, sessionConfig });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.on("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}`;

    // Phase 1 — fresh session (session/new, no load).
    const created = await fetch(`${url}/chat/init`);
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as { sessionId: string };
    assert.ok(createdBody.sessionId.length > 0);

    // Phase 2 — "page refresh": the backend is now busy (emits after-load
    // updates), so the probe promotes a passive turn before init returns.
    const initRes = await fetch(`${url}/chat/init?sessionId=${createdBody.sessionId}`);
    assert.equal(initRes.status, 200);
    const body = (await initRes.json()) as {
      activeTurn: boolean;
      resumed: boolean;
      history: Array<{ kind: string; patches?: Array<{ type: string; delta?: string }> }>;
    };
    assert.equal(body.resumed, true);
    assert.equal(body.activeTurn, true, "a busy backend must be reported active after the probe");
    assert.ok(
      body.history.some((e) => e.kind === "assistant" && e.patches?.some((p) => p.type === "text-delta" && typeof p.delta === "string")),
      "the buffered tail should be presented as this turn's history",
    );

    // Phase 3 — second refresh while the passive turn is still alive: the
    // resident fast-path must reuse the session WITHOUT another session/load.
    const again = await fetch(`${url}/chat/init?sessionId=${createdBody.sessionId}`);
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { activeTurn: boolean }).activeTurn, true);
    const log = fs.existsSync(eventLogFile)
      ? fs.readFileSync(eventLogFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.equal(
      log.filter((e: { method: string }) => e.method === "session/load").length,
      1,
      "the fast-path refresh must not re-load the session",
    );

    // Phase 4 — /chat/stream reattaches to the passive turn: buffered tail
    // replays, then the synthesized done closes the stream.
    const streamRes = await fetch(`${url}/chat/stream?sessionId=${createdBody.sessionId}`);
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get("content-type") ?? "", /text\/event-stream/);
    const text = await streamRes.text();
    const events = text.split("\n\n").filter((s) => s.startsWith("data: ")).map((s) => JSON.parse(s.slice(6)));
    const deltas = events
      .filter((e) => e.type === "text-delta" && typeof e.delta === "string")
      .map((e) => e.delta)
      .join("");
    assert.equal(deltas, "one two three", "the buffered tail must replay on /chat/stream");
    assert.equal(events[events.length - 1].type, "done", "passive turn must close the stream with a synthesized done");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (registry) await registry.shutdown();
    await fs.rm(ws, { recursive: true, force: true });
    fs.rmSync(eventLogFile, { force: true });
    if (probe === undefined) delete process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS;
    else process.env.JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS = probe;
    if (grace === undefined) delete process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
    else process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS = grace;
  }
});
```

Check the file's imports at the top of `src/server.test.ts` already include everything used (they do from the 1225–1314 and 900–951 tests: `createBackendRegistry`, `createSettingsStore`, `createSessionConfigStore`, `createToolRegistry`, `mkWorkspace`, `FAKE_AGENT`, `BackendProfile`, `fs`, `os`, `path`). This test sets `JARVIS_BRIDGE_PASSIVE_TURN_PROBE_MS="2000"` inline because the file-level `beforeEach` from Task 5 zeroes it.

Timing budget (single host, ms-scale): init#2 load → burst at +200/215/230ms, probe resolves ~+200ms; init#3 fast-path ~+3ms; `/chat/stream` attach ~+6ms; grace "500" retires the turn at ~+730ms (done). The stream fetch always lands well before retirement.

- [ ] **Step 2: Run the test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern="backend-busy session" src/server.test.ts`
Expected: FAIL at the first `assert.equal(body.activeTurn, true, ...)` — before the server wiring from Task 5… wait, Task 5 is already committed; to see it fail here, note this test is the one that REQUIRES a real agent subprocess (FakeBackend cannot emit post-load updates), so it cannot pass on the mock-based server alone: with no promotion, `activeTurn` stays `false`.

- [ ] **Step 3: Verify it passes**

Run the same command again. Expected: PASS (all four phases). Then `npm run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add src/server.test.ts
git commit -m "test(server): passive turn streams buffered tail then closes on done; fast-path skips reload"
```

---

### Task 7: Per-backend wire verification + spec status

**Files:**
- Verify (manual): live opencode, Claude (`@agentclientprotocol/claude-agent-acp`), Codex (`@agentclientprotocol/codex-acp`)
- Modify: `docs/superpowers/specs/2026-09-21-passive-turn-promotion-design.md`

Goal: confirm the real agents keep emitting post-replay notifications inside the probe window for a session busy outside jarvis, and that `loadSession`'s replay of a partially-streamed in-flight message behaves (drives the frontend's double-up heuristic). Mark the spec implemented.

- [ ] **Step 1: Manual probe — opencode**

1. Start `npm run dev` with default `opencode`.
2. Open `localhost:PORT` fresh, start a chat. In a second terminal started from the SAME workspace dir as the chat, run `opencode` and ask for a slow job (e.g. "write a large file with 2000 lines").
3. While the CLI is still working, refresh the jarvis tab for that session.
Expected: `GET /chat/init` returns `activeTurn: true`; the refresh shows the live tail; when the CLI finishes, quiet-grace `done` closes the drawer; the transcript shows the full turn on the next reload.
Also confirm: a second refresh before the CLI finishes hits the fast path (no visible lag).

- [ ] **Step 2: Manual probe — Claude and Codex**

Repeat the same scenario with the default set to `claude` (Claude Code CLI active in the same cwd) and to `codex`. Record in the plan's notes (or a follow-up email/issue, not a commit here) which of the three agents streaming behavior showed:
- whether the in-flight message's partial text appears in the buffered tail vs. only after completion (drives the `useChat.ts:126-145` double-up behavior);
- whether any agent replays a truncated partially-streamed message on `session/load`.

The risk this surfaces is content duplication in the transcript during a passive turn + reload; if a real agent misbehaves, the resolution is a follow-up spec + task, not a silent fix here.

- [ ] **Step 3: Update the spec**

In `docs/superpowers/specs/2026-09-21-passive-turn-promotion-design.md`:

- Change `Status: draft` to `Status: implemented` and add a line `Implemented: 2026-09-21` (preserving the original `Date: 2026-09-21`).
- Note the per-backend wire-shape findings from Steps 1–2 under `## Testing` (append a short paragraph after the existing per-backend bullet).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-21-passive-turn-promotion-design.md
git commit -m "docs: spec implemented + per-backend wire-shape verification"
```

---

## Self-review notes

- **Spec coverage:** constraints §1–5 map to Tasks 3–4 (no polling; one mechanism; done never synthesized early; reuse activeTurn/stream machinery; passive reaper exemption). Design §2 (probe window) → Tasks 2, 5; §3 (turn-end semantics) → Task 4; §4 data-flow → Task 3; §5 (404 fallback, reattach heuristic, approval routing) → explicitly no code change, Tasks 6/7 verify. Spec Testing → Tasks 3, 4, 5, 6, 7.
- **Known edge (out of scope, per decision):** `onExit` sends an `error` patch via `ctx.onPatch`; if the subprocess dies during a passive turn, the viewer stream stays open until quiet-grace retires the turn. No error special-casing in the passive router; flagged for Task 7's manual pass.
- **Type consistency:** `passiveProbeMs` (types.ts, loadSession, server.ts), `origin: "send" | "passive"` (SessionContext, sendMessage literal, getActiveTurn, armPassiveGrace), `graceTimer`, `passiveTurnWaiter`, `clearPassiveTurnTimers`, `getPassiveTurnProbeMs` — defined exactly once each and referenced consistently.
- **Mock-timers hazard:** all passive tests that run `loadSession` use real timers + the grace env knob; the existing `t.mock.timers` reaper tests (which start via `sendMessage`, not `loadSession`) are untouched.