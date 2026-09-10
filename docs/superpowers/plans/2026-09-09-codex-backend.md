# Codex Backend Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI Codex as a first-class jarvis_bridge backend by running the `@agentclientprotocol/codex-acp` ACP adapter as the backend subprocess, with native mid-turn steering for Codex.

**Architecture:** Codex doesn't speak ACP, so we spawn the first-party `codex-acp` adapter (same pattern as the Claude adapter). Most capabilities auto-negotiate over the ACP `initialize` handshake. The only code changes are: (1) a small capability-detection tweak in `connect()` to recognize Codex's `_meta.steering.supported`, (2) a re-added `_session/steering` RPC path (`AcpAgentSession.steer()` + `POST /chat/steer`) for native mid-turn steering, and (3) frontend transport selection via a new `nativeSteering` capability.

**Tech Stack:** TypeScript (Node `node:test` + `assert` backend tests, Vitest + Testing Library frontend tests), Express + `ws` gateway, `@agentclientprotocol/codex-acp` adapter.

---

### Task 1: Add `nativeSteering` to the `AgentCapabilities` contract

**Files:**
- Modify: `src/agent/types.ts:4-19` (AgentCapabilities)
- Modify: `frontend/src/api/types.ts:1-13` (AgentCapabilities)

The backend and frontend each declare a mirror `AgentCapabilities` interface. Add a `nativeSteering: boolean` field to both so the frontend can distinguish Codex's native `_session/steering` RPC from Claude/opencode's client-side queueing.

- [ ] **Step 1: Add the field to the backend contract**

In `src/agent/types.ts`, add `nativeSteering: boolean;` to `AgentCapabilities`, next to the existing `steer` field:

```typescript
export interface AgentCapabilities {
  multipleSessions: boolean;
  customWorkingDirectory: boolean;
  cancel: boolean;
  steer: boolean;
  nativeSteering: boolean;
  toolApprovals: boolean;
  slashCommands: boolean;
  canFork: boolean;
  images: boolean;
  sessionDelete: boolean;
  promptQueueing: boolean;
  // On-demand subscription rate-limit query (see AgentBackend.queryUsage) —
  // true only for backends that can shell out to a CLI that supports it
  // (currently just Claude).
  usageQuery: boolean;
}
```

- [ ] **Step 2: Add the field to the frontend contract**

In `frontend/src/api/types.ts`, add `nativeSteering: boolean;` to `AgentCapabilities`, next to `steer`:

```typescript
export interface AgentCapabilities {
  multipleSessions: boolean;
  customWorkingDirectory: boolean;
  cancel: boolean;
  steer: boolean;
  nativeSteering: boolean;
  toolApprovals: boolean;
  slashCommands: boolean;
  canFork: boolean;
  images: boolean;
  sessionDelete: boolean;
  promptQueueing: boolean;
  usageQuery: boolean;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the field is now required on both sides; no compile errors yet because no object literal omits it — the next task wires it up).

- [ ] **Step 4: Commit**

```bash
git add src/agent/types.ts frontend/src/api/types.ts
git commit -m "feat: add nativeSteering capability flag"
```

---

### Task 2: Detect Codex steering in `connect()` and widen `steer`

**Files:**
- Modify: `src/agent/acp/index.ts:161-182` (`connect()` initialize parsing)
- Test: `src/agent/acp/index.test.ts`

Set `steer = promptQueueing || steeringMeta` and populate `nativeSteering` from `_meta.steering.supported` (Codex) alongside the existing `_meta.claudeCode.promptQueueing` (Claude/opencode).

- [ ] **Step 1: Add the fake-agent fixture capability for steering**

In `test/fixtures/fake-streaming-agent.cjs`, add an env read near line 72:

```javascript
const advertiseSteering = process.env.X_FAKE_AGENT_STEERING === "true";
```

Then extend the `initialize` reply (lines 327-336) so the `_meta` object also carries `steering.supported` when requested. Replace the current `_meta` spread line:

```javascript
agentCapabilities: {
  promptCapabilities: { image: true },
  sessionCapabilities: advertiseDelete ? { fork: {}, delete: {} } : { fork: {} },
  extensions: { "jarvis-bridge/steer": {} },
  ...(advertisePromptQueueing ? { _meta: { claudeCode: { promptQueueing: true } } } : {}),
  ...(advertiseSteering ? { _meta: { steering: { supported: true } } } : {}),
},
```

Note: if both env flags are set the two `_meta` spreads merge (object spread), so a test must set only one. Update the doc-comment header list (lines 5-47) to document `X_FAKE_AGENT_STEERING` (advertise `_meta.steering.supported`).

- [ ] **Step 2: Write the failing test**

Add to `src/agent/acp/index.test.ts`, near the existing `promptQueueing capability is true...` test (line 612):

```typescript
test("nativeSteering is true and steer is true when the agent advertises _meta.steering.supported", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: { ...process.env, X_FAKE_AGENT_STEERING: "true" },
  });
  try {
    assert.equal(backend.capabilities.steer, true);
    assert.equal(backend.capabilities.nativeSteering, true);
    assert.equal(backend.capabilities.promptQueueing, false);
  } finally {
    await backend.shutdown();
  }
});

test("nativeSteering is false and steer stays tied to promptQueueing for a claude-style agent", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: { ...process.env, X_FAKE_AGENT_PROMPT_QUEUEING: "true" },
  });
  try {
    assert.equal(backend.capabilities.steer, true);
    assert.equal(backend.capabilities.nativeSteering, false);
    assert.equal(backend.capabilities.promptQueueing, true);
  } finally {
    await backend.shutdown();
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: FAIL — `nativeSteering` is `undefined` (not yet set) and `steer` is false for the steering-only agent.

- [ ] **Step 4: Implement the detection**

In `src/agent/acp/index.ts`, in `connect()`:

1. Update the `initRes` type to include the steering meta (line 166):

```typescript
      _meta?: {
        claudeCode?: { promptQueueing?: boolean };
        steering?: { supported?: boolean };
      };
```

2. Update the two reads and the capability assignment (lines 176-182):

```typescript
    const promptQueueing = caps._meta?.claudeCode?.promptQueueing === true;
    const nativeSteering = caps._meta?.steering?.supported === true;

    this.capabilities.steer = promptQueueing || nativeSteering;
    this.capabilities.nativeSteering = nativeSteering;
    this.capabilities.canFork = canFork;
    this.capabilities.sessionDelete = sessionDelete;
    this.capabilities.images = images;
    this.capabilities.promptQueueing = promptQueueing;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: PASS (both new tests green, and the pre-existing assertion at line 40 `capabilities.steer === capabilities.promptQueueing` still holds for claude-style fixtures since `nativeSteering` is false there).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/acp/index.ts src/agent/acp/index.test.ts test/fixtures/fake-streaming-agent.cjs
git commit -m "feat(acp): detect codex _meta.steering.supported as nativeSteering"
```

---

### Task 3: Re-add `AcpAgentSession.steer()` for native `_session/steering`

**Files:**
- Modify: `src/agent/acp/index.ts` (`AcpAgentSession`, after `cancel()` ~line 1080)
- Modify: `test/fixtures/fake-streaming-agent.cjs`
- Test: `src/agent/acp/index.test.ts`

Codex exposes a native `_session/steering` RPC: request `{ sessionId, prompt: ContentBlock[] }`, response `{ outcome: "injected" | "startedNewTurn" | "failed" }`. Re-add the `steer?` optional method on `AcpAgentSession` (deleted in the steer redesign) so the backend can issue it for `nativeSteering` backends.

- [ ] **Step 1: Add the `_session/steering` handler to the fake agent**

In `test/fixtures/fake-streaming-agent.cjs`, add a `_session/steering` case to the `switch` (before `default`). Add a variable near line 72:

```javascript
const steeringOutcome = process.env.X_FAKE_AGENT_STEERING_OUTCOME || "injected";
```

Then add the case:

```javascript
    case "_session/steering":
      logEvent(msg.method, msg.params);
      reply(msg.id, { outcome: steeringOutcome });
      break;
```

Document `X_FAKE_AGENT_STEERING_OUTCOME` (one of `injected` | `startedNewTurn` | `failed`) in the header comment.

- [ ] **Step 2: Write the failing test**

Add to `src/agent/acp/index.test.ts`:

```typescript
test("steer() issues _session/steering and returns the codex outcome", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: { ...process.env, X_FAKE_AGENT_STEERING: "true" },
  });
  try {
    const session = await backend.createSession();
    const res = await session.steer?.("please focus on the parser");
    assert.deepEqual(res, { accepted: true, reason: undefined });
  } finally {
    await backend.shutdown();
  }
});
```

Note: if the `steer?` method is absent (current code), `session.steer` is `undefined` and this call throws at `session.steer?.(...)` — the test fails. Optionally add a stronger assertion by capturing the fixture's received method (via the existing `logEvent` file hook if present); for a first pass, asserting the method returns without throwing plus a follow-on check that `steer` is a function is sufficient.

- [ ] **Step 3: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: FAIL — `session.steer` is `undefined` (method not yet added).

- [ ] **Step 4: Implement `AcpAgentSession.steer()`**

In `src/agent/acp/index.ts`, add a `steer()` method to `AcpAgentSession` right after `cancel()` (line 1080). The `steer?` signature on `AgentSession` (`types.ts:49`) is `steer?(prompt: string): Promise<{ accepted: boolean; reason?: string }>`:

```typescript
  async steer(prompt: string): Promise<{ accepted: boolean; reason?: string }> {
    if (!this.backend.capabilities.nativeSteering) {
      return { accepted: false, reason: "native steering not supported" };
    }
    try {
      const res = (await this.backend
        .getConnection()
        .sendRequest("_session/steering", {
          sessionId: this.id,
          prompt: [{ type: "text", text: prompt }],
        })) as { outcome?: "injected" | "startedNewTurn" | "failed" };
      const outcome = res?.outcome;
      if (outcome === "failed") {
        return { accepted: false, reason: "steer failed" };
      }
      return { accepted: true };
    } catch (err) {
      return {
        accepted: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
```

This returns the generic `{ accepted, reason }` contract the frontend/server expect; `injected`/`startedNewTurn` both map to `accepted: true`.

- [ ] **Step 5: Run test to verify it passes**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the `steer?` method already exists on the `AgentSession` interface, so no interface change needed).

- [ ] **Step 7: Commit**

```bash
git add src/agent/acp/index.ts src/agent/acp/index.test.ts test/fixtures/fake-streaming-agent.cjs
git commit -m "feat(acp): re-add AcpAgentSession.steer() for codex _session/steering"
```

---

### Task 4: Add `POST /chat/steer` route

**Files:**
- Modify: `src/server.ts`
- Test: `src/server.test.ts` (or the backend test file used by the suite)

Re-add the `POST /chat/steer` route (deleted in the steer redesign) so the frontend can trigger native `_session/steering` for codex. It resolves the session, calls `session.steer?(prompt)`, and returns the outcome.

- [ ] **Step 1: Check existing route helpers**

In `src/server.ts`, confirm the `chatJson` middleware and `asyncRoute` wrapper exist (they wrap `/chat/send` at line 265). These are reused as-is.

- [ ] **Step 2: Write the failing test**

Find where `src/server.test.ts` (or the backend test file) exercises the chat routes, and add:

```typescript
test("POST /chat/steer returns the steer outcome for a native-steering backend", async () => {
  // spawn the test app with a codex-style backend (steering advertised)
  // then POST /chat/steer { sessionId, prompt }
  // assert 200 and body matches the backend's steer() result
});
```

If the existing suite doesn't spawn an HTTP app, add the test at the `AcpAgentSession`/route level instead (asserting `steer()` is invoked and its result returned). Match the file's existing fixture/spawn pattern exactly.

- [ ] **Step 3: Run test to verify it fails**

Run: the server test file (see AGENTS.md for the single-file command)
Expected: FAIL — 404/route missing.

- [ ] **Step 4: Implement the route**

In `src/server.ts`, add a `POST /chat/steer` route alongside the other chat routes. It must resolve the session entry (mirroring `resolveSessionEntry` used by `/chat/usage`, `/chat/model`, etc.), guard for a missing `steer?` method, and call it:

```typescript
  app.post("/chat/steer", chatJson, asyncRoute(async (req, res) => {
    const { sessionId, prompt } = req.body as { sessionId?: string; prompt?: string };
    if (!sessionId || typeof prompt !== "string" || !prompt) {
      res.status(400).json({ error: "sessionId and prompt (string) are required" });
      return;
    }
    const entry = await resolveSessionEntry(sessionId);
    const session = entry?.backend.getSession?.(sessionId);
    if (!session?.steer) {
      res.status(400).json({ error: "steer not supported by this backend" });
      return;
    }
    const outcome = await session.steer(prompt);
    res.json(outcome);
  }));
```

Match the existing `resolveSessionEntry` signature and error-shape conventions used by sibling routes in the file.

- [ ] **Step 5: Run test to verify it passes**

Run: the server test file
Expected: PASS.

- [ ] **Step 6: Typecheck + full backend test run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat(server): re-add POST /chat/steer for native codex steering"
```

---

### Task 5: Frontend — route Steer to native RPC for codex

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx:379-381` (`onSteerComposer`)
- Modify: `frontend/src/state/useChat.ts`
- Test: `frontend/src/components/ChatPanel.test.tsx` (or the nearest existing test)

Make the Steer button call `POST /chat/steer` when `capabilities.nativeSteering` is true (codex), else fall back to `enqueueMessage` (Claude/opencode).

- [ ] **Step 1: Write the failing test**

Add a test in the frontend suite asserting that `onSteerComposer` calls the native `/chat/steer` route when `nativeSteering` is true, and `enqueueMessage` otherwise. Match the existing test harness (Vitest + Testing Library, mock `fetch`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx`
Expected: FAIL — no native-steer branch exists yet.

- [ ] **Step 3: Implement the branch**

In `frontend/src/state/useChat.ts`, add a `steerMessage` function that POSTs `/chat/steer`, and in `frontend/src/components/ChatPanel.tsx`, change `onSteerComposer` to choose the transport:

```typescript
const onSteerComposer = useCallback(async (text: string) => {
  if (ctx.state.capabilities?.nativeSteering) {
    await chat.steerMessage(text);
  } else {
    chat.enqueueMessage(text);
  }
}, [chat]);
```

Implement `steerMessage` in `useChat.ts` to `POST /chat/steer` with `{ sessionId, prompt: text }` (mirror the existing `fetchJSON`/`/chat/send` call style), and add a lightweight transcript entry so the steered prompt is visible.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ChatPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + full frontend test run**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/state/useChat.ts frontend/src/components/ChatPanel.test.tsx
git commit -m "feat(frontend): steer via native /chat/steer for codex, queue otherwise"
```

---

### Task 6: Add the Codex backend profile

**Files:**
- Modify: `agents.json.example` (repo template; the runtime file lives in `~/.jarvis-bridge-system/config/agents.json`)
- Modify: `scripts/setup.js` (if it scaffolds a default agents.json list)

Add the Codex profile so a fresh setup includes it.

- [ ] **Step 1: Add the profile to the example/template**

In `agents.json.example` (and the default list scaffolded by `scripts/setup.js`), add:

```json
{
  "name": "codex",
  "kind": "codex-acp",
  "command": "npx",
  "args": ["-y", "@agentclientprotocol/codex-acp@latest"],
  "env": {}
}
```

Match the existing indentation/ordering style of the file.

- [ ] **Step 2: Verify setup scaffolding**

Run: inspect `scripts/setup.js` to confirm it writes a default `agents.json` with the backends list; add codex there if a hardcoded list exists. If the file only copies a template, no code change beyond Step 1.

- [ ] **Step 3: Commit**

```bash
git add agents.json.example scripts/setup.js
git commit -m "chore(config): add codex backend profile"
```

---

### Task 7: Docs — `docs/agent-codex.md` and AGENTS.md update

**Files:**
- Create: `docs/agent-codex.md`
- Modify: `AGENTS.md` (Backend configuration section)

Document the Codex binding profile and the steering capability, mirroring `docs/agent-claude-code.md`. This is a reviewable document per the AGENTS.md plannotator workflow.

- [ ] **Step 1: Write `docs/agent-codex.md`**

Create `docs/agent-codex.md` capturing (mirror the structure of `docs/agent-claude-code.md`):

- **Invocation:** `npx -y @agentclientprotocol/codex-acp@latest`; working dir via `session/new`'s `cwd`; auth via `~/.codex` reuse (out-of-band `codex login`), no ACP auth round-trip for a logged-in user; the adapter bundles its own `@openai/codex` (set `CODEX_PATH` to use a specific binary).
- **Transport:** standard ACP stdio JSON-RPC; the adapter spawns the Codex app server and translates.
- **Capabilities:** `sessionCapabilities.{resume,list,close,delete,fork,additionalDirectories}`, `loadSession: true`, `promptCapabilities.image`, `_meta.steering.supported`. `usageQuery` off (no CLI probe wired).
- **Steering:** native `_session/steering` RPC (`injected`/`startedNewTurn`/`failed`), distinct from Claude/opencode's queueing; surfaced via `nativeSteering` capability.
- **Known wire-shape gotchas:** to be filled in from the live probe (Verification section below) — resume/Past Chats replay, auth-required error shape.

- [ ] **Step 2: Update AGENTS.md**

In `AGENTS.md` → Backend configuration, add a sentence noting codex ships via `@agentclientprotocol/codex-acp` (same adapter pattern as claude) and that its steer is native `_session/steering` (detected via `nativeSteering`), distinct from the `promptQueueing`-based steer. Reference `docs/agent-codex.md`.

- [ ] **Step 3: Run through plannotator review**

Run: `plannotator annotate docs/agent-codex.md`
Wait for the user's review and apply annotations before committing.

- [ ] **Step 4: Commit**

```bash
git add docs/agent-codex.md AGENTS.md
git commit -m "docs: add codex binding profile (docs/agent-codex.md)"
```

---

### Task 8: Live verification probe (resume/Past Chats + steering)

**Files:**
- Modify: `docs/agent-codex.md` (pin real captured values)

This task confirms the adapter's real wire behavior before declaring resume/Past Chats and steering production-ready, mirroring what `docs/agent-claude-code.md` did. It is manual; do not claim completion without a live codex session.

- [ ] **Step 1: Start the gateway with codex as a backend**

Run: `npm run dev` (or `npm start`), with the codex profile in `agents.json`. Confirm the codex pool spawns and `initialize` succeeds (`gateway.log`).

- [ ] **Step 2: Probe create + send + replay**

Using the curl round-trips in `docs/acp-notes.md` ("Verifying replay end-to-end"), confirm:
- `POST /chat/init` creates a codex session.
- `POST /chat/send` streams text/tool patches and a final `done`.
- `GET /chat/init?sessionId=<SID>` replays history (resume works).

- [ ] **Step 3: Probe Past Chats / fork / delete**

Confirm `GET /chat/sessions`, fork, and delete work against the codex session. Note any `session/load` replay quirks.

- [ ] **Step 4: Probe native steering**

Confirm the Steer button (or `POST /chat/steer`) injects mid-turn (returns `{ accepted: true }`) and starts a new turn when idle.

- [ ] **Step 5: Probe unsigned-user auth error**

If `~/.codex` is signed out, confirm a clean "auth required" error surfaces (vs a crash/hang).

- [ ] **Step 6: Pin findings in `docs/agent-codex.md`**

Record the probed adapter version, wire-shape gotchas, and any deltas from this plan's assumptions in `docs/agent-codex.md` (Task 7's "Known wire-shape gotchas" section). Commit:

```bash
git add docs/agent-codex.md
git commit -m "docs(agent-codex): pin live probe results"
```

---

## Self-Review

**Spec coverage:**
- Profile (§1) → Task 6 ✓
- Capability detection / `nativeSteering` (§2) → Tasks 1-2 ✓
- Native steer RPC + route (§3) → Tasks 3-4 ✓
- Frontend transport selection (§3) → Task 5 ✓
- Docs `docs/agent-codex.md` + AGENTS.md (§4) → Task 7 ✓
- Tests (§5) → Tasks 2, 3, 4, 5 ✓
- Non-goals (usageQuery off, auth out-of-band, no subagent negotiation) → preserved: Task 2 keeps `usageQuery = kind === "claude-acp"`; Task 8 probes but does not implement interactive auth ✓
- Verification (§ Verification) → Task 8 ✓

**Placeholder scan:** Task 4 Step 2 and Task 5 Step 1 contain abbreviated test bodies with a "match the existing pattern" instruction rather than complete code, because the exact server-test harness shape varies across the suite. These are flagged as the one spot an engineer must read the surrounding file; the plan is otherwise fully specified. Acceptable for this codebase, but the implementer should fill them in from the existing fixtures.

**Type consistency:** `nativeSteering` added to both `AgentCapabilities` interfaces (Task 1) and set in `connect()` (Task 2); `steer()` matches the `AgentSession.steer?` signature `{ accepted: boolean; reason?: string }` (Task 3); the route reads `session.steer` and `resolveSessionEntry` (Task 4) consistent with sibling routes.