# Session Config Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mode / Effort / Agent dropdowns next to the existing Model picker in the Composer, driven generically by whatever `configOptions` the connected backend reports.

**Architecture:** Claude's ACP adapter already returns `configOptions[]` on `session/new` and `session/load`, and `parseSessionConfig` already captures them into `SessionContext.rawConfigOptions` — nothing exposes them over HTTP. This plan widens that parse to keep `name`/`category`/`type`, adds two optional `AgentBackend` methods and a generic route pair around them, persists choices per session, and renders one `<Select>` per reported option. `model` is excluded everywhere — `/chat/model` keeps sole ownership of it.

**Tech Stack:** TypeScript (strict), Express + zod (backend), `node:test` + `assert` (backend tests), React + Vite (frontend), Vitest + Testing Library (frontend tests).

**Spec:** `docs/superpowers/specs/2026-08-28-session-config-pickers-design.md`

## Global Constraints

- TypeScript `strict: true` on both sides. `exactOptionalPropertyTypes` is **not** set, so assigning `undefined` to an optional property is legal.
- Backend is CommonJS, frontend is ESM. Match surrounding file style; no reformatting of untouched code.
- Backend tests use `node:test` + `node:assert/strict` only. No third-party runner.
- No new comments beyond short, necessary ones. The repo keeps comment density low and explanatory.
- `model` is never settable through the new generic path — `POST /chat/config-option` rejects `configId: "model"` with 400, and `AcpAgentBackend.setSessionConfigOption` throws on it.
- Backends that report no config options must degrade to rendering nothing extra. No `kind`-based branching anywhere in shared code (`src/server.ts`, `src/agent/acp/mapping.ts`).
- Gates: `npm run typecheck` and `npm test` at repo root; `cd frontend && npm run typecheck` and `npm run test:web` from root.
- **Do not run `git commit` without asking the user first.** Commit steps below are written out, but each needs an explicit go-ahead.

## File Structure

**Backend**
- `src/agent/types.ts` — add `SessionConfigOption` interface + two optional `AgentBackend` methods. Pure type surface.
- `src/agent/acp/index.ts` — widen `parseSessionConfig`, add `RawConfigOption` type alias, add `getSessionConfigOptions` / `setSessionConfigOption` to `AcpAgentBackend`.
- `src/agent/sessionConfigStore.ts` — add `configOverrides` persistence.
- `src/server.ts` — two routes, one `/chat/init` field, resume re-apply loop, two zod schemas.
- `test/fixtures/fake-streaming-agent.cjs` — richer Claude-style config set + a `session/set_mode` handler.
- `test/fixtures/fakeBackend.ts` — optional config-option surface for route tests.

**Frontend**
- `frontend/src/api/types.ts` — `ConfigOption` + `ChatInitResponse.configOptions`.
- `frontend/src/state/ChatContext.tsx` — `configOptions` state + `setConfigOptions`.
- `frontend/src/state/useChat.ts` — `setConfigOption(configId, value)`.
- `frontend/src/components/ChatPanel.tsx` — wiring only.
- `frontend/src/components/Composer.tsx` — generic `<Select>` loop.

---

### Task 1: Widen the config parse to keep name / category / type

`parseSessionConfig` currently drops everything except `id`, `currentValue`, and `options`. The pickers need `name` (label), `category` (mode routing), and `type` (filtering). This task also loosens `currentValue` to `unknown`, because boolean options like Claude's `fast` put a non-string there and the current type is a lie.

**Files:**
- Modify: `src/agent/acp/index.ts:769-798` (`SessionConfigResponse`, `parseSessionConfig`), `src/agent/acp/index.ts:80` (`SessionContext.rawConfigOptions`)
- Modify: `test/fixtures/fake-streaming-agent.cjs:78-96` (config fixture)
- Test: `src/agent/acp/index.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `RawConfigOption` (module-local type in `src/agent/acp/index.ts`), shape
  `{ id: string; name?: string; category?: string; type?: string; currentValue?: unknown; options: Array<{ value?: string; name?: string }> }`.
  `parseSessionConfig` returns `{ models, rawConfigOptions: RawConfigOption[], modes }` — unchanged apart from the widened element type.

- [ ] **Step 1: Enrich the fake agent's Claude-style config set**

In `test/fixtures/fake-streaming-agent.cjs`, replace the `claudeStyleConfig` branch of the `configOptions` array (currently model + effort) with a set that covers every filtering rule the pickers need: a mode option, a boolean option, and an option with no `type` field at all.

```javascript
const configOptions = claudeStyleConfig
  ? [
      { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Manual" }, { value: "plan", name: "Plan Mode" }] },
      { id: "model", name: "Model", category: "model", type: "select", currentValue: "claude-fake", options: [{ value: "claude-fake", name: "Claude Fake" }] },
      { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
      { id: "agent", name: "Agent", currentValue: "default", options: [{ value: "default" }, { value: "reviewer" }] },
      { id: "fast", name: "Fast", type: "boolean", currentValue: false, options: [] },
    ]
  : [
```

Leave the non-`claudeStyleConfig` branch exactly as it is — the existing model tests depend on it.

- [ ] **Step 2: Write the failing test**

Append to the final `describe` block in `src/agent/acp/index.test.ts` (the one ending at line 739):

```typescript
  test("parseSessionConfig keeps name, category and type instead of dropping them", async () => {
    const backend = await newBackend({ X_FAKE_AGENT_CLAUDE_STYLE_CONFIG: "true" });
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      const raw = backend.getSessionRawConfig(session.id);
      const effort = raw?.rawConfigOptions?.find((o) => o.id === "effort");
      assert.equal(effort?.name, "Effort");
      assert.equal(effort?.category, "thought_level");
      assert.equal(effort?.type, "select");
      // A boolean option's currentValue is not a string — the type must allow it
      // through the parse rather than mistyping it.
      const fast = raw?.rawConfigOptions?.find((o) => o.id === "fast");
      assert.equal(fast?.currentValue, false);
    } finally {
      await backend.shutdown();
    }
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: FAIL — `effort?.name` is `undefined` (the parse drops it).

- [ ] **Step 4: Add the `RawConfigOption` alias and widen the response type**

In `src/agent/acp/index.ts`, add the alias just above `interface SessionConfigResponse` (line 769):

```typescript
interface RawConfigOption {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  currentValue?: unknown;
  options: Array<{ value?: string; name?: string }>;
}
```

Replace `SessionConfigResponse`'s `configOptions` element type:

```typescript
interface SessionConfigResponse {
  configOptions?: Array<{
    id?: string;
    name?: string;
    category?: string;
    type?: string;
    currentValue?: unknown;
    options?: Array<{ value?: string; name?: string }>;
  }>;
  modes?: { currentModeId?: string; availableModes?: Array<{ id?: string; name?: string }> };
}
```

- [ ] **Step 5: Rewrite the `rawConfigOptions` build in `parseSessionConfig`**

Replace the function's signature return type and the first three statements:

```typescript
function parseSessionConfig(res: SessionConfigResponse | undefined): {
  models: { available: Array<{ modelId: string; name: string }>; current: string };
  rawConfigOptions: RawConfigOption[];
  modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name?: string }> };
} {
  const opts = res?.configOptions;
  const rawConfigOptions: RawConfigOption[] = (opts ?? [])
    .filter((o): o is typeof o & { id: string } => typeof o.id === "string")
    .map((o) => ({
      id: o.id,
      name: o.name,
      category: o.category,
      type: o.type,
      currentValue: o.currentValue,
      options: o.options ?? [],
    }));
  const modelOpt = rawConfigOptions.find((o) => o.id === MODEL_CONFIG_ID);
```

Then fix the `models` line, which can no longer assume `currentValue` is a string:

```typescript
  const modelCurrent = typeof modelOpt?.currentValue === "string" ? modelOpt.currentValue : undefined;
  const models = { available, current: modelCurrent ?? available[0]?.modelId ?? "" };
```

- [ ] **Step 6: Update the `SessionContext` field to the alias**

At `src/agent/acp/index.ts:80`, replace the inline type:

```typescript
  rawConfigOptions?: RawConfigOption[];
```

- [ ] **Step 7: Run the full backend suite**

Run: `npm test`
Expected: PASS, including the pre-existing `createSession captures modes and non-model configOptions without dropping them` and both `setSessionModel` tests — the fixture change kept `effort`'s `currentValue` at `"medium"` and the model option's values intact.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `modelOpt?.currentValue` is referenced anywhere else, the widened type surfaces it here.

- [ ] **Step 9: Commit** (ask the user first)

```bash
git add src/agent/acp/index.ts test/fixtures/fake-streaming-agent.cjs src/agent/acp/index.test.ts
git commit -m "refactor(acp): keep name/category/type when parsing session configOptions"
```

---

### Task 2: `getSessionConfigOptions` on the backend interface

Exposes the pickable subset of `rawConfigOptions` in a normalized, protocol-generic shape.

**Files:**
- Modify: `src/agent/types.ts:78-124` (add interface + two optional methods)
- Modify: `src/agent/acp/index.ts` (add method near `getSessionModels`, line ~565; add helpers near `parseSessionConfig`)
- Test: `src/agent/acp/index.test.ts`

**Interfaces:**
- Consumes: `RawConfigOption` from Task 1.
- Produces:
  ```typescript
  export interface SessionConfigOption {
    id: string;
    name: string;
    category?: string;
    currentValue: string;
    options: Array<{ value: string; name: string }>;
  }
  ```
  and `AgentBackend.getSessionConfigOptions?(sessionId: string): SessionConfigOption[] | null`.
  Returns `null` when the session has no config at all (route answers `supported: false`); an empty array means "config exists, nothing pickable".

- [ ] **Step 1: Write the failing test**

Append to the final `describe` block in `src/agent/acp/index.test.ts`:

```typescript
  test("getSessionConfigOptions returns pickable options and excludes model and booleans", async () => {
    const backend = await newBackend({ X_FAKE_AGENT_CLAUDE_STYLE_CONFIG: "true" });
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      const opts = backend.getSessionConfigOptions(session.id);
      assert.ok(opts);
      const ids = opts!.map((o) => o.id);
      assert.deepEqual(ids, ["mode", "effort", "agent"]);
      // `model` is owned by /chat/model; `fast` is boolean-valued.
      assert.ok(!ids.includes("model"));
      assert.ok(!ids.includes("fast"));
      // `agent` has no `type` field at all and must still come through.
      assert.equal(opts!.find((o) => o.id === "agent")?.name, "Agent");
      // Option labels fall back to the raw value when the agent omits `name`.
      const effort = opts!.find((o) => o.id === "effort");
      assert.equal(effort?.currentValue, "medium");
      assert.deepEqual(effort?.options, [
        { value: "low", name: "low" },
        { value: "medium", name: "medium" },
        { value: "high", name: "high" },
      ]);
    } finally {
      await backend.shutdown();
    }
  });

  test("getSessionConfigOptions returns null for an unknown session", async () => {
    const backend = await newBackend();
    try {
      assert.equal(backend.getSessionConfigOptions("nope"), null);
    } finally {
      await backend.shutdown();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: FAIL — `backend.getSessionConfigOptions is not a function`.

- [ ] **Step 3: Add the shared type to `src/agent/types.ts`**

Insert after `SessionModelsInfo` (line 81):

```typescript
// One pickable session config option, normalized from ACP `configOptions[]`.
// Deliberately protocol-generic: any backend that reports select-style options
// gets a picker, with no per-backend id vocabulary baked in here.
export interface SessionConfigOption {
  id: string;
  name: string;
  category?: string;
  currentValue: string;
  options: Array<{ value: string; name: string }>;
}
```

Add to the `AgentBackend` interface, right after `setSessionModel` (line 108):

```typescript
  getSessionConfigOptions?(sessionId: string): SessionConfigOption[] | null;
  setSessionConfigOption?(sessionId: string, configId: string, value: string): Promise<void>;
```

- [ ] **Step 4: Add the filter/normalize helpers**

In `src/agent/acp/index.ts`, below `parseSessionConfig`:

```typescript
// A config option is pickable when it renders as a select with a string value.
// `type` is optional in the ACP shape — an agent that omits it still means a
// select, so only an explicit non-"select" type disqualifies. The string check
// on currentValue is what actually excludes boolean options like Claude's `fast`.
function isPickableConfigOption(o: RawConfigOption): boolean {
  if (o.id === MODEL_CONFIG_ID) return false;
  if (o.type !== undefined && o.type !== "select") return false;
  if (typeof o.currentValue !== "string") return false;
  return o.options.some((opt) => typeof opt.value === "string");
}

function toSessionConfigOption(o: RawConfigOption): SessionConfigOption {
  return {
    id: o.id,
    name: o.name ?? o.id,
    category: o.category,
    currentValue: o.currentValue as string,
    options: o.options
      .filter((opt): opt is { value: string; name?: string } => typeof opt.value === "string")
      .map((opt) => ({ value: opt.value, name: opt.name ?? opt.value })),
  };
}
```

Add `SessionConfigOption` to the existing type-only import from `"../types"` at the top of the file (the block containing `SessionModelsInfo`).

- [ ] **Step 5: Add the method to `AcpAgentBackend`**

Insert directly after `getSessionModels` (line ~565):

```typescript
  getSessionConfigOptions(sessionId: string): SessionConfigOption[] | null {
    const ctx = this.sessions.get(sessionId);
    if (!ctx?.rawConfigOptions) return null;
    return ctx.rawConfigOptions.filter(isPickableConfigOption).map(toSessionConfigOption);
  }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add src/agent/types.ts src/agent/acp/index.ts src/agent/acp/index.test.ts
git commit -m "feat(acp): expose pickable session config options"
```

---

### Task 3: `setSessionConfigOption` — the generic setter

Handles every option except mode (Task 4) and model (rejected outright).

**Files:**
- Modify: `src/agent/acp/index.ts` (add method after `setSessionModel`, line ~605)
- Test: `src/agent/acp/index.test.ts`

**Interfaces:**
- Consumes: `RawConfigOption`, `isPickableConfigOption`, `toSessionConfigOption`, `MODEL_CONFIG_ID` from Tasks 1-2.
- Produces: `AcpAgentBackend.setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<void>` — throws on unknown session, unknown configId, unknown value, or `configId === "model"`.

- [ ] **Step 1: Write the failing tests**

Append to the final `describe` block in `src/agent/acp/index.test.ts`:

```typescript
  test("setSessionConfigOption sends session/set_config_option and adopts the refreshed response", async () => {
    const eventLogFile = path.join(os.tmpdir(), `evlog-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    const backend = await newBackend({
      X_FAKE_AGENT_CLAUDE_STYLE_CONFIG: "true",
      X_FAKE_AGENT_EVENT_LOG_FILE: eventLogFile,
    });
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      await backend.setSessionConfigOption(session.id, "effort", "high");
      assert.equal(
        backend.getSessionConfigOptions(session.id)?.find((o) => o.id === "effort")?.currentValue,
        "high",
      );
      const log = fs.readFileSync(eventLogFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const setCall = log.find((e: { method: string }) => e.method === "session/set_config_option");
      assert.ok(setCall);
      assert.equal(setCall.params.configId, "effort");
      assert.equal(setCall.params.value, "high");
    } finally {
      await backend.shutdown();
      fs.rmSync(eventLogFile, { force: true });
    }
  });

  test("setSessionConfigOption rejects unknown ids, unknown values, and model", async () => {
    const backend = await newBackend({ X_FAKE_AGENT_CLAUDE_STYLE_CONFIG: "true" });
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      await assert.rejects(
        () => backend.setSessionConfigOption(session.id, "nonesuch", "x"),
        /unknown configId/,
      );
      await assert.rejects(
        () => backend.setSessionConfigOption(session.id, "effort", "nonesuch"),
        /unknown value/,
      );
      // The model picker owns `model` — a second writer would desync the
      // persisted override in server.ts.
      await assert.rejects(
        () => backend.setSessionConfigOption(session.id, "model", "claude-fake"),
        /setSessionModel/,
      );
    } finally {
      await backend.shutdown();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: FAIL — `backend.setSessionConfigOption is not a function`.

- [ ] **Step 3: Implement the method**

Insert directly after `setSessionModel` in `src/agent/acp/index.ts` (after line ~605):

```typescript
  async setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx?.rawConfigOptions) throw new Error("unknown session or config options not loaded");
    if (configId === MODEL_CONFIG_ID) {
      throw new Error("model is set through setSessionModel, not setSessionConfigOption");
    }
    const option = ctx.rawConfigOptions.find((o) => o.id === configId);
    if (!option) throw new Error(`unknown configId: ${configId}`);
    if (!option.options.some((o) => o.value === value)) {
      throw new Error(`unknown value for ${configId}: ${value}`);
    }
    const res = (await this.conn.sendRequest("session/set_config_option", {
      sessionId,
      configId,
      value,
    })) as SessionConfigResponse;
    // The response carries every option with a refreshed currentValue — adopt
    // it wholesale rather than assuming the requested value stuck, same reason
    // setSessionModel does (agents resolve values, they don't just validate).
    const parsed = res?.configOptions?.length ? parseSessionConfig(res) : null;
    if (parsed) {
      ctx.rawConfigOptions = parsed.rawConfigOptions;
      if (parsed.models.available.length > 0) {
        ctx.availableModels = parsed.models.available;
        ctx.currentModelId = parsed.models.current;
      }
    } else {
      option.currentValue = value;
    }
    console.log(`[ACP] setSessionConfigOption sessionId=${sessionId} ${configId}=${value}`);
  }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** (ask the user first)

```bash
git add src/agent/acp/index.ts src/agent/acp/index.test.ts
git commit -m "feat(acp): add setSessionConfigOption for non-model config options"
```

---

### Task 4: Route mode-category options through `session/set_mode`

`session/set_mode` is the ACP method that exists for modes and the one confirmed working against the live Claude adapter (`docs/agent-claude-code.md:177-180`). Whether that adapter's `setSessionConfigOption` handler also accepts `configId: "mode"` was never probed, so mode doesn't go through it.

**Files:**
- Modify: `test/fixtures/fake-streaming-agent.cjs` (add a `session/set_mode` case next to `session/set_model`, line ~389)
- Modify: `src/agent/acp/index.ts` (branch inside `setSessionConfigOption`)
- Test: `src/agent/acp/index.test.ts`

**Interfaces:**
- Consumes: `setSessionConfigOption` from Task 3.
- Produces: no new signature. `setSessionConfigOption` gains a `category === "mode"` branch; `ctx.modes.currentModeId` moves with it.

- [ ] **Step 1: Add a `session/set_mode` handler to the fake agent**

In `test/fixtures/fake-streaming-agent.cjs`, insert a new case directly before `case "session/set_model":`:

```javascript
    case "session/set_mode": {
      const modeId = msg.params?.modeId;
      if (!modes.availableModes.some((m) => m.id === modeId)) {
        replyError(msg.id, -32602, `Unknown mode: ${modeId}`);
        break;
      }
      modes.currentModeId = modeId;
      const option = configOptions.find((o) => o.id === "mode");
      if (option) option.currentValue = modeId;
      reply(msg.id, {});
      break;
    }
```

- [ ] **Step 2: Write the failing test**

Append to the final `describe` block in `src/agent/acp/index.test.ts`:

```typescript
  test("setSessionConfigOption routes mode-category options through session/set_mode", async () => {
    const eventLogFile = path.join(os.tmpdir(), `evlog-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    const backend = await newBackend({
      X_FAKE_AGENT_CLAUDE_STYLE_CONFIG: "true",
      X_FAKE_AGENT_EVENT_LOG_FILE: eventLogFile,
    });
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      await backend.setSessionConfigOption(session.id, "mode", "plan");
      assert.equal(
        backend.getSessionConfigOptions(session.id)?.find((o) => o.id === "mode")?.currentValue,
        "plan",
      );
      assert.equal(backend.getSessionRawConfig(session.id)?.modes?.currentModeId, "plan");
      const log = fs.readFileSync(eventLogFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      assert.ok(
        log.some((e: { method: string }) => e.method === "session/set_mode"),
        "mode must go through session/set_mode",
      );
      assert.ok(
        !log.some(
          (e: { method: string; params?: { configId?: string } }) =>
            e.method === "session/set_config_option" && e.params?.configId === "mode",
        ),
        "mode must not be written through set_config_option",
      );
    } finally {
      await backend.shutdown();
      fs.rmSync(eventLogFile, { force: true });
    }
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`
Expected: FAIL — the `session/set_mode` assertion fails; the call went out as `set_config_option`.

- [ ] **Step 4: Add the mode branch**

In `src/agent/acp/index.ts`, add the constant next to `MODEL_CONFIG_ID` (line ~43):

```typescript
// Mode has its own ACP method (`session/set_mode`); it appears in configOptions
// too, but that duplicate is read-only as far as we're concerned.
const MODE_CONFIG_CATEGORY = "mode";
```

Then insert this block inside `setSessionConfigOption`, between the value validation and the `sendRequest("session/set_config_option", ...)` call:

```typescript
    if (option.category === MODE_CONFIG_CATEGORY) {
      await this.conn.sendRequest("session/set_mode", { sessionId, modeId: value });
      // set_mode answers with no refreshed config, so move local state by hand.
      option.currentValue = value;
      if (ctx.modes) ctx.modes.currentModeId = value;
      console.log(`[ACP] setSessionConfigOption sessionId=${sessionId} mode=${value}`);
      return;
    }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit** (ask the user first)

```bash
git add src/agent/acp/index.ts test/fixtures/fake-streaming-agent.cjs src/agent/acp/index.test.ts
git commit -m "feat(acp): set mode-category options via session/set_mode"
```

---

### Task 5: Persist config overrides in `session_metadata.json`

**Files:**
- Modify: `src/agent/sessionConfigStore.ts`
- Test: `src/agent/sessionConfigStore.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: on `SessionConfigStore` —
  `getConfigOverrides(sessionId: string): Record<string, string>` (always an object, `{}` when none) and
  `setConfigOverride(sessionId: string, configId: string, value: string | null): Promise<void>` (a `null` value deletes the entry).
  On-disk key: `configOverrides: Record<sessionId, Record<configId, string>>`.

- [ ] **Step 1: Write the failing test**

Append to `src/agent/sessionConfigStore.test.ts`, following the file's existing `storePath(dir)` helper convention:

```typescript
test("config overrides round-trip through disk and null deletes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-cfg-"));
  try {
    const p = storePath(dir);
    const store = await createSessionConfigStore({ path: p, envDefault: false });
    assert.deepEqual(store.getConfigOverrides("s1"), {});
    await store.setConfigOverride("s1", "effort", "high");
    await store.setConfigOverride("s1", "mode", "plan");
    assert.deepEqual(store.getConfigOverrides("s1"), { effort: "high", mode: "plan" });

    const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
    assert.deepEqual(reloaded.getConfigOverrides("s1"), { effort: "high", mode: "plan" });

    await reloaded.setConfigOverride("s1", "mode", null);
    assert.deepEqual(reloaded.getConfigOverrides("s1"), { effort: "high" });

    await reloaded.setConfigOverride("s1", "effort", null);
    assert.deepEqual(reloaded.getConfigOverrides("s1"), {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

If `storePath` is not already imported/defined in that file, use `path.join(dir, "session_metadata.json")` inline — that is what `storePath` returns (`src/agent/sessionConfigStore.test.ts:10`).

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/sessionConfigStore.test.ts`
Expected: FAIL — `store.getConfigOverrides is not a function`.

- [ ] **Step 3: Extend the interface and persisted shape**

In `src/agent/sessionConfigStore.ts`, add to `SessionConfigStore` after `setModelOverride` (line 33):

```typescript
  getConfigOverrides(sessionId: string): Record<string, string>;
  setConfigOverride(sessionId: string, configId: string, value: string | null): Promise<void>;
```

Add to `PersistedFileShape` after `modelOverrides` (line 53):

```typescript
  configOverrides?: Record<string, Record<string, string>>;
```

- [ ] **Step 4: Add the sanitizer**

Below `sanitizeGroups` (line 115):

```typescript
function sanitizeConfigOverrides(raw: unknown): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  if (!raw || typeof raw !== "object") return out;
  for (const [sid, perSession] of Object.entries(raw as Record<string, unknown>)) {
    if (!perSession || typeof perSession !== "object") continue;
    const inner = new Map<string, string>();
    for (const [configId, value] of Object.entries(perSession as Record<string, unknown>)) {
      if (typeof value === "string") inner.set(configId, value);
    }
    if (inner.size > 0) out.set(sid, inner);
  }
  return out;
}
```

- [ ] **Step 5: Load, persist, and expose it**

After the `modelOverrides` map (line 148):

```typescript
  const configOverrides = sanitizeConfigOverrides(persisted.configOverrides);
```

In `persist()`'s `data` literal, after `modelOverrides` (line 164):

```typescript
      configOverrides: Object.fromEntries(
        [...configOverrides].map(([sid, m]) => [sid, Object.fromEntries(m)]),
      ),
```

In the returned object, after `setModelOverride` (line 200):

```typescript
    getConfigOverrides(sessionId: string): Record<string, string> {
      const m = configOverrides.get(sessionId);
      return m ? Object.fromEntries(m) : {};
    },
    async setConfigOverride(sessionId: string, configId: string, value: string | null): Promise<void> {
      const m = configOverrides.get(sessionId) ?? new Map<string, string>();
      if (value == null) m.delete(configId);
      else m.set(configId, value);
      if (m.size === 0) configOverrides.delete(sessionId);
      else configOverrides.set(sessionId, m);
      await persist();
    },
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add src/agent/sessionConfigStore.ts src/agent/sessionConfigStore.test.ts
git commit -m "feat: persist per-session config option overrides"
```

---

### Task 6: `GET /chat/config-options` and the `/chat/init` field

**Files:**
- Modify: `src/server.ts` (route after `/chat/model`'s POST, line ~424; init response, line ~222; zod schema, line ~804)
- Modify: `test/fixtures/fakeBackend.ts`
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes: `SessionConfigOption` and `getSessionConfigOptions` from Task 2.
- Produces:
  - `GET /chat/config-options?sessionId=` → `{ ok: true, supported: boolean, options: SessionConfigOption[] }`; 404 when the session doesn't resolve.
  - `/chat/init` response gains `configOptions: SessionConfigOption[]` (always an array; `[]` when unsupported).
  - `FakeBackendOptions.configOptions?: SessionConfigOption[]` — when omitted, `getSessionConfigOptions` returns `null` and `setSessionConfigOption` is **absent** from the instance, so the 501 path is reachable.

- [ ] **Step 1: Give `FakeBackend` an optional config-option surface**

In `test/fixtures/fakeBackend.ts`, add to `FakeBackendOptions` (after `models`, line 89):

```typescript
  // Present to exercise the supported path; omitted (default) to exercise the
  // 501-not-supported path, matching how server.ts gates on method presence.
  configOptions?: SessionConfigOption[];
```

Add `SessionConfigOption` to the existing type-only import block at the top of the file (lines 5-14). Note that block's specifier reads `"../agent/types"`, which does not actually resolve from `test/fixtures/` — it survives because the import is type-only (erased by `TS_NODE_TRANSPILE_ONLY=true`) and `tsconfig.json` includes only `src/**/*`, so `tsc --noEmit` never sees this file. Leave the path as-is; fixing it is out of scope.

Add the instance state next to `currentModelBySession` (line 117):

```typescript
  public configValuesBySession = new Map<string, Map<string, string>>();
  public setSessionConfigOption?: (sessionId: string, configId: string, value: string) => Promise<void>;
```

In the constructor, next to the `if (opts.queryUsage)` line (line 137):

```typescript
    if (opts.configOptions) {
      this.setSessionConfigOption = async (sessionId: string, configId: string, value: string) => {
        const opt = opts.configOptions!.find((o) => o.id === configId);
        if (!opt) throw new Error(`unknown configId: ${configId}`);
        if (!opt.options.some((o) => o.value === value)) {
          throw new Error(`unknown value for ${configId}: ${value}`);
        }
        const m = this.configValuesBySession.get(sessionId) ?? new Map<string, string>();
        m.set(configId, value);
        this.configValuesBySession.set(sessionId, m);
      };
    }
```

Add the getter next to `setSessionModel` (line 221):

```typescript
  getSessionConfigOptions(sessionId: string): SessionConfigOption[] | null {
    if (!this.opts.configOptions) return null;
    const overrides = this.configValuesBySession.get(sessionId);
    return this.opts.configOptions.map((o) => ({
      ...o,
      currentValue: overrides?.get(o.id) ?? o.currentValue,
    }));
  }
```

- [ ] **Step 2: Write the failing tests**

Append to `src/server.test.ts`:

```typescript
const FAKE_CONFIG_OPTIONS = [
  {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
];

test("GET /chat/config-options returns the backend's options", async () => {
  await withServer(async () => ({
    backend: new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS }),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/config-options?sessionId=${initBody.sessionId}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        supported: boolean;
        options: Array<{ id: string; currentValue: string }>;
      };
      assert.equal(body.supported, true);
      assert.equal(body.options.length, 1);
      assert.equal(body.options[0].id, "effort");
      assert.equal(body.options[0].currentValue, "medium");
    },
  }));
});

test("GET /chat/config-options reports unsupported when the backend has none", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/config-options?sessionId=${initBody.sessionId}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { supported: boolean; options: unknown[] };
      assert.equal(body.supported, false);
      assert.deepEqual(body.options, []);
    },
  }));
});

test("GET /chat/config-options 404s for an unknown session", async () => {
  await withServer(async () => ({
    backend: new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS }),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/config-options?sessionId=nope`);
      assert.equal(res.status, 404);
    },
  }));
});

test("GET /chat/init carries configOptions", async () => {
  await withServer(async () => ({
    backend: new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS }),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/init`);
      const body = (await res.json()) as { configOptions: Array<{ id: string }> };
      assert.deepEqual(body.configOptions.map((o) => o.id), ["effort"]);
    },
  }));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: FAIL — the route 404s (unregistered) and `body.configOptions` is `undefined`.

- [ ] **Step 4: Add the zod schema**

In `src/server.ts`, next to `ModelQuerySchema` (line 804):

```typescript
const ConfigOptionsQuerySchema = z.object({ sessionId: z.string().optional() });
```

- [ ] **Step 5: Add the route**

Directly after the `POST /chat/model` handler closes (line ~424):

```typescript
  // ── Session config options (mode / effort / agent / …) ─────────────
  // Deliberately generic: whatever select-style options the connected backend
  // reports get a picker. `model` is excluded by the backend and rejected on
  // POST — /chat/model owns it, including its persisted override.
  app.get("/chat/config-options", smallJson, asyncRoute(async (req, res) => {
    const q = ConfigOptionsQuerySchema.parse(req.query);
    const entry = await resolveSessionEntry(registry, q.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const options = entry.backend.getSessionConfigOptions?.(entry.summary.sessionId) ?? null;
    if (!options) {
      res.json({ ok: true, supported: false, options: [] });
      return;
    }
    res.json({ ok: true, supported: true, options });
  }));
```

- [ ] **Step 6: Add the init field**

In the `/chat/init` response literal, immediately after the `model:` entry (line ~224):

```typescript
      configOptions: backend.getSessionConfigOptions?.(session.id) ?? [],
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit** (ask the user first)

```bash
git add src/server.ts test/fixtures/fakeBackend.ts src/server.test.ts
git commit -m "feat: expose session config options over HTTP"
```

---

### Task 7: `POST /chat/config-option` with persistence and resume re-apply

**Files:**
- Modify: `src/server.ts` (route after the GET from Task 6; resume block at line ~125-135; zod schema)
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes: `setSessionConfigOption` (Tasks 3-4), `getSessionConfigOptions` (Task 2), `getConfigOverrides` / `setConfigOverride` (Task 5).
- Produces: `POST /chat/config-option { sessionId, configId, value }` → `{ ok: true, options: SessionConfigOption[] }` (refreshed). 400 for `configId: "model"`, unknown id, or unknown value; 404 unknown session; 501 when the backend can't set options.

- [ ] **Step 1: Write the failing tests**

Append to `src/server.test.ts` (reuses `FAKE_CONFIG_OPTIONS` from Task 6):

```typescript
test("POST /chat/config-option sets the value and returns refreshed options", async () => {
  await withServer(async () => ({
    backend: new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS }),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/config-option`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: initBody.sessionId, configId: "effort", value: "high" }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; options: Array<{ id: string; currentValue: string }> };
      assert.equal(body.ok, true);
      assert.equal(body.options.find((o) => o.id === "effort")?.currentValue, "high");
    },
  }));
});

test("POST /chat/config-option rejects model, unknown ids, and unknown values", async () => {
  await withServer(async () => ({
    backend: new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS }),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const { sessionId } = (await initRes.json()) as { sessionId: string };
      const post = (payload: Record<string, string>) =>
        fetch(`${url}/chat/config-option`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, ...payload }),
        });
      assert.equal((await post({ configId: "model", value: "m1" })).status, 400);
      assert.equal((await post({ configId: "nonesuch", value: "x" })).status, 400);
      assert.equal((await post({ configId: "effort", value: "nonesuch" })).status, 400);
    },
  }));
});

test("POST /chat/config-option returns 501 when the backend can't set options", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const { sessionId } = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/config-option`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, configId: "effort", value: "high" }),
      });
      assert.equal(res.status, 501);
    },
  }));
});

test("a config override is persisted and re-applied when the session resumes", async () => {
  await withServer(async () => {
    const backend = new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS });
    return {
      backend,
      fn: async (url) => {
        const initRes = await fetch(`${url}/chat/init`);
        const { sessionId } = (await initRes.json()) as { sessionId: string };
        await fetch(`${url}/chat/config-option`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, configId: "effort", value: "high" }),
        });
        // Drop the in-memory value the way a gateway restart would, leaving
        // only the persisted override to restore it.
        backend.configValuesBySession.clear();
        const resumeRes = await fetch(`${url}/chat/init?sessionId=${sessionId}`);
        const resumeBody = (await resumeRes.json()) as {
          configOptions: Array<{ id: string; currentValue: string }>;
        };
        assert.equal(
          resumeBody.configOptions.find((o) => o.id === "effort")?.currentValue,
          "high",
        );
      },
    };
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/server.test.ts`
Expected: FAIL — `POST /chat/config-option` is unregistered (404 from Express, not the expected statuses).

- [ ] **Step 3: Add the zod schema**

In `src/server.ts`, next to `ConfigOptionsQuerySchema`:

```typescript
const ConfigOptionPostBodySchema = z.object({
  sessionId: z.string(),
  configId: z.string(),
  value: z.string(),
});
```

- [ ] **Step 4: Add the route**

Directly after the `GET /chat/config-options` handler:

```typescript
  app.post("/chat/config-option", smallJson, asyncRoute(async (req, res) => {
    const body = ConfigOptionPostBodySchema.parse(req.body ?? {});
    if (body.configId === "model") {
      res.status(400).json({ error: "use POST /chat/model to change the model" });
      return;
    }
    const entry = await resolveSessionEntry(registry, body.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    if (!entry.backend.setSessionConfigOption) {
      res.status(501).json({ error: "config options not supported" });
      return;
    }
    try {
      await entry.backend.setSessionConfigOption(body.sessionId, body.configId, body.value);
      const options = entry.backend.getSessionConfigOptions?.(body.sessionId) ?? [];
      // Persist what the backend landed on, not what was asked for — an agent
      // may resolve the requested value, and a stored override that disagrees
      // gets re-applied on every resume.
      const landed = options.find((o) => o.id === body.configId)?.currentValue ?? body.value;
      await opts.sessionConfig?.setConfigOverride(body.sessionId, body.configId, landed);
      res.json({ ok: true, options });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  }));
```

- [ ] **Step 5: Re-apply stored overrides on resume**

In `/chat/init`, immediately after the `if (storedModel) { … }` block (line ~135):

```typescript
        const storedConfig = opts.sessionConfig?.getConfigOverrides(q.sessionId) ?? {};
        for (const [configId, value] of Object.entries(storedConfig)) {
          try {
            await backend.setSessionConfigOption?.(q.sessionId, configId, value);
          } catch (e) {
            console.log(`[INIT]   re-apply ${configId}=${value} failed: ${e instanceof Error ? e.message : e}`);
          }
        }
```

Best-effort by design: a stale override for an option the agent no longer reports must not fail the resume.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: set and persist session config options"
```

---

### Task 8: Frontend types and `ChatContext` state

**Files:**
- Modify: `frontend/src/api/types.ts:16` (next to `ModelInfo`), `:37-53` (`ChatInitResponse`)
- Modify: `frontend/src/state/ChatContext.tsx` (state, initial, init handler, action, memo deps)
- Modify: `frontend/src/components/InfoPanel.test.tsx:7` (full `ChatState` literal needs the new field)
- Modify: `frontend/src/state/ChatContext.test.tsx:8` and `frontend/src/state/useChat.test.tsx:17` (both declare a full `ChatInitResponse` literal named `baseInit`, so a new required field breaks their typecheck)
- Test: `frontend/src/state/ChatContext.test.tsx`

**Interfaces:**
- Consumes: the `/chat/init` `configOptions` field from Task 6.
- Produces:
  ```typescript
  export interface ConfigOption {
    id: string;
    name: string;
    category?: string;
    currentValue: string;
    options: Array<{ value: string; name: string }>;
  }
  ```
  `ChatState.configOptions: ConfigOption[]` and `ChatContextApi.setConfigOptions: (options: ConfigOption[]) => void`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("ChatContext", …)` block in `frontend/src/state/ChatContext.test.tsx`:

```typescript
  it("init copies configOptions from the server response into state", async () => {
    const configOptions = [
      {
        id: "effort",
        name: "Effort",
        category: "thought_level",
        currentValue: "medium",
        options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }],
      },
    ];
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: { ...baseInit, configOptions } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.configOptions).toHaveLength(1);
    expect(result.current.state.configOptions[0].id).toBe("effort");
    expect(result.current.state.configOptions[0].currentValue).toBe("medium");
  });
```

Note `init()` also fires a follow-up `/chat/groups` fetch; `fetchJSONSpy.mockResolvedValue` answers both calls with the same payload, which is what the file's existing tests already rely on.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/state/ChatContext.test.tsx`
Expected: FAIL — `state.configOptions` is `undefined`.

- [ ] **Step 3: Add the API type**

In `frontend/src/api/types.ts`, after `ModelInfo` (line 16):

```typescript
export interface ConfigOption {
  id: string;
  name: string;
  category?: string;
  currentValue: string;
  options: Array<{ value: string; name: string }>;
}
```

Add to `ChatInitResponse`, after the `model` field (line 51):

```typescript
  configOptions: ConfigOption[];
```

- [ ] **Step 4: Thread it through `ChatContext`**

In `frontend/src/state/ChatContext.tsx`:

Add `ConfigOption` to the type-only import from `"../api/types"` (line 6-9).

Add to `ChatState`, after `currentModel` (line 19):

```typescript
  configOptions: ConfigOption[];
```

Add to `INITIAL`, after `currentModel: null` (line 44):

```typescript
  configOptions: [],
```

Add to `ChatContextApi`, after `setModels` (line 72):

```typescript
  setConfigOptions: (options: ConfigOption[]) => void;
```

In the `init` state update, after `currentModel:` (line 185):

```typescript
          configOptions: d.configOptions || [],
```

Add the action next to `setModels` (line 243):

```typescript
  const setConfigOptions = useCallback((options: ConfigOption[]) => {
    setState((s) => ({ ...s, configOptions: options }));
  }, []);
```

Add `setConfigOptions` to **both** the `useMemo` object and its dependency array (lines 283-284).

- [ ] **Step 5: Fix the three full-object literals in existing tests**

Both new required fields break test files that build a complete object literal. All three need one line added:

`frontend/src/components/InfoPanel.test.tsx:7` (`baseState: ChatState`) — add after `currentModel: "m1"` (line 21):

```typescript
  configOptions: [],
```

`frontend/src/state/ChatContext.test.tsx:8` (`baseInit: ChatInitResponse`) — add after the `model:` line (line 34):

```typescript
  configOptions: [],
```

`frontend/src/state/useChat.test.tsx:17` (`baseInit: ChatInitResponse`) — add after the `model:` line (line 34):

```typescript
  configOptions: [],
```

- [ ] **Step 6: Run the frontend gates**

Run: `npm run test:web && cd frontend && npm run typecheck`
Expected: PASS, no type errors. `npm run test:web` alone will not catch a missing literal — Vitest transpiles without typechecking, so `npm run typecheck` is the gate that matters here.

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add frontend/src/api/types.ts frontend/src/state/ChatContext.tsx frontend/src/state/ChatContext.test.tsx frontend/src/state/useChat.test.tsx frontend/src/components/InfoPanel.test.tsx
git commit -m "feat(frontend): carry session config options in ChatContext"
```

---

### Task 9: `useChat.setConfigOption`

**Files:**
- Modify: `frontend/src/state/useChat.ts:60` (result type), `:346-355` (next to `setModel`), `:374-394` (return object)
- Test: `frontend/src/state/useChat.test.tsx`

**Interfaces:**
- Consumes: `POST /chat/config-option` (Task 7), `ctx.setConfigOptions` (Task 8).
- Produces: `UseChatResult.setConfigOption: (configId: string, value: string) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("useChat", …)` block in `frontend/src/state/useChat.test.tsx`. There is no existing `setModel` test to copy from — this is the full test:

```typescript
  it("posts a config option change and adopts the refreshed options", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });

    const refreshed = [
      {
        id: "effort",
        name: "Effort",
        currentValue: "high",
        options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }],
      },
    ];
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: { ok: true, options: refreshed } });
    await act(async () => { await result.current.setConfigOption("effort", "high"); });

    expect(fetchJSONSpy).toHaveBeenLastCalledWith("/chat/config-option", {
      method: "POST",
      body: { sessionId: "sess-1", configId: "effort", value: "high" },
    });
    expect(
      result.current.context.state.configOptions.find((o) => o.id === "effort")?.currentValue,
    ).toBe("high");
  });

  it("leaves the previous config value in place when the change is rejected", async () => {
    const initial = [
      {
        id: "effort",
        name: "Effort",
        currentValue: "medium",
        options: [{ value: "medium", name: "Medium" }, { value: "high", name: "High" }],
      },
    ];
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: { ...baseInit, configOptions: initial } });
    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });

    fetchJSONSpy.mockResolvedValue({ ok: false, status: 400, data: { error: "unknown value" } });
    await act(async () => { await result.current.setConfigOption("effort", "high"); });

    expect(
      result.current.context.state.configOptions.find((o) => o.id === "effort")?.currentValue,
    ).toBe("medium");
  });
```

The second test is the one that pins the "a failed POST must not lie about what the agent is running" behavior from the spec.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/state/useChat.test.tsx`
Expected: FAIL — `result.current.setConfigOption is not a function`.

- [ ] **Step 3: Implement it**

Add `ConfigOption` to the type-only import from `"../api/types"` at the top of `useChat.ts`.

Add to `UseChatResult`, after `setModel` (line 60):

```typescript
  setConfigOption: (configId: string, value: string) => Promise<void>;
```

Add the callback directly after `setModel` (line 355):

```typescript
  const setConfigOption = useCallback(async (configId: string, value: string) => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ ok: boolean; options: ConfigOption[] }>(
      "/chat/config-option",
      { method: "POST", body: { sessionId: ctx.state.sessionId, configId, value } },
    );
    // Only the response moves state — a rejected change leaves the picker on
    // its previous value rather than lying about what the agent is running.
    if (res.ok && res.data?.options) ctx.setConfigOptions(res.data.options);
  }, [ctx]);
```

Add `setConfigOption` to the returned object, after `setModel` (line 392).

- [ ] **Step 4: Run the frontend gates**

Run: `npm run test:web && cd frontend && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** (ask the user first)

```bash
git add frontend/src/state/useChat.ts frontend/src/state/useChat.test.tsx
git commit -m "feat(frontend): add setConfigOption to useChat"
```

---

### Task 10: Render the pickers in the Composer

**Files:**
- Modify: `frontend/src/components/Composer.tsx:13-44` (props), `:229-235` (after the Model `<Select>`)
- Modify: `frontend/src/components/ChatPanel.tsx:353-358` (callback), `:646-667` (props)
- Test: `frontend/src/components/Composer.test.tsx`

**Interfaces:**
- Consumes: `ConfigOption` (Task 8), `chat.setConfigOption` (Task 9).
- Produces: `ComposerProps.configOptions: ConfigOption[]` and
  `ComposerProps.onConfigOptionChange: (configId: string, value: string) => void`.
  `Select` derives `data-testid` from `aria-label` (`select-<label lowercased, spaces to dashes>`, `Select.tsx:139`), so an option named `Effort` is `screen.getByTestId("select-effort")`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/Composer.test.tsx`, add the two new props to `baseProps` (line 10-30):

```typescript
  configOptions: [] as ConfigOption[],
  onConfigOptionChange: vi.fn(),
```

with `import type { ConfigOption, ImageAttachment } from "../api/types";`. Then append:

```typescript
  it("renders one select per reported config option", () => {
    const configOptions: ConfigOption[] = [
      { id: "mode", name: "Mode", category: "mode", currentValue: "default",
        options: [{ value: "default", name: "Manual" }, { value: "plan", name: "Plan Mode" }] },
      { id: "effort", name: "Effort", currentValue: "medium",
        options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
    ];
    render(<Composer {...baseProps} configOptions={configOptions} />);
    expect(screen.getByTestId("select-mode")).toBeInTheDocument();
    expect(screen.getByTestId("select-effort")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("reports the picked config option value", () => {
    const onConfigOptionChange = vi.fn();
    const configOptions: ConfigOption[] = [
      { id: "effort", name: "Effort", currentValue: "medium",
        options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
    ];
    render(
      <Composer {...baseProps} configOptions={configOptions} onConfigOptionChange={onConfigOptionChange} />,
    );
    fireEvent.click(screen.getByTestId("select-effort"));
    fireEvent.mouseDown(screen.getByText("High"));
    expect(onConfigOptionChange).toHaveBeenCalledWith("effort", "high");
  });

  it("renders no extra selects when the backend reports none", () => {
    render(<Composer {...baseProps} />);
    expect(screen.queryByTestId("select-effort")).not.toBeInTheDocument();
  });
```

`Select` commits a choice on `mouseDown` (`Select.tsx:170-173`), not `click`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/Composer.test.tsx`
Expected: FAIL — `select-effort` is not in the document.

- [ ] **Step 3: Add the props**

In `frontend/src/components/Composer.tsx`, add `ConfigOption` to the type-only import on line 2. Add to `ComposerProps`, after `onModelChange` (line 23):

```typescript
  configOptions: ConfigOption[];
  onConfigOptionChange: (configId: string, value: string) => void;
```

Add both to the destructure (line 40):

```typescript
    models, currentModel, onModelChange,
    configOptions, onConfigOptionChange,
```

- [ ] **Step 4: Render the loop**

Immediately after the Model `<Select>` closes (line 235):

```tsx
          {configOptions.map((opt) => (
            <Select
              key={opt.id}
              value={opt.currentValue}
              options={opt.options.map((o) => ({ value: o.value, label: o.name }))}
              onChange={(value) => onConfigOptionChange(opt.id, value)}
              aria-label={opt.name}
            />
          ))}
```

No CSS change — `.actionsLeft` is already `flex-wrap: wrap` (`Composer.module.css:64-69`).

- [ ] **Step 5: Wire `ChatPanel`**

Add the callback after `onModelChange` (line 358):

```typescript
  const onConfigOptionChange = useCallback(
    (configId: string, value: string) => {
      void chat.setConfigOption(configId, value);
    },
    [chat],
  );
```

Add to the `<Composer>` element after `onModelChange` (line 656):

```tsx
            configOptions={ctx.state.configOptions}
            onConfigOptionChange={onConfigOptionChange}
```

- [ ] **Step 6: Run every gate**

Run: `npm run test:web && cd frontend && npm run typecheck`
Then from the repo root: `npm test && npm run typecheck`
Expected: all PASS. `ChatPanel.test.tsx` renders the real `Composer`; if it stubs props anywhere, the two new required props must be added there too.

- [ ] **Step 7: Manual verification against a live Claude backend**

Run `npm run dev` and `npm run dev:web`, open `localhost:5173`, and confirm: Model, Mode, Effort, and Agent all render; changing Effort persists across a page reload; changing Mode to `Manual` makes tool calls start producing approval cards (which is the `auto` → `default` behavior change, not a bug).

- [ ] **Step 8: Commit** (ask the user first)

```bash
git add frontend/src/components/Composer.tsx frontend/src/components/Composer.test.tsx frontend/src/components/ChatPanel.tsx
git commit -m "feat(frontend): render mode/effort/agent pickers in the composer"
```

---

## Post-implementation

Update `docs/claude-acp-future-phases.md` — the "`session/set_mode` + `session/set_config_option` pickers" section is what this plan delivers. Leave the boolean `fast` toggle and the `current_mode_update` / `config_option_update` live-sync gap listed as still-deferred, and note that agent-initiated changes go stale until reload.
