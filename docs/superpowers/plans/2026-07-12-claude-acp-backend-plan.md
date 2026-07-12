# Claude ACP Backend (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `claude-agent-acp` as a second, capability-driven ACP backend in jarvis_bridge, selectable as the default backend via a Settings-page control, alongside the existing opencode backend — with no per-agent branching in the shared streaming/mapping code.

**Architecture:** A new JSON config (`agents.json`) lists named backend profiles; a new `BackendRegistry` layer composes one `BackendPool` per profile (each pool keeping today's per-cwd pooling behavior unchanged) and exposes a runtime-mutable "default backend" concept backed by a small `settings.json` file. `server.ts` resolves the *owning* backend per session (not a single global `chatBackend`) so multiple backend kinds can be live at once. All Claude-specific behavior (session delete, native prompt queueing) is exposed as new capability flags derived from the handshake, exactly like the existing `steer`/`canFork` flags — never a hardcoded backend-kind check.

**Tech Stack:** TypeScript (Node `node:test` for backend tests, Vitest for frontend), Express, React. No new dependencies.

## Global Constraints

- Node >=22 required by `@agentclientprotocol/claude-agent-acp` (repo's existing `engines.node` is `>=20` in `package.json` — bump it as part of Task 10).
- `strict: true` TypeScript — no `any`; match the existing codebase's explicit-typing style (see `src/agent/acp/index.ts` for the idiom: inline response-shape casts, not shared DTfeatureos).
- Tests use `node:test` + `node:assert/strict` for backend code (`npm test`), Vitest for frontend (`npm run test:web`). Follow existing file-per-module test naming (`foo.ts` → `foo.test.ts`).
- No backwards-compatibility shim for the old `AGENT_CMD`/`AGENT_ARGS`/`AGENT_MODEL` env vars — `agents.json` fully replaces them per the approved design spec (`docs/superpowers/specs/2026-07-12-claude-acp-backend-design.md`). Update `.env.example` to remove them and point at `agents.json.example`.
- Never branch on a backend's `kind` string in `src/agent/acp/*` or `src/server.ts` — every behavioral difference is capability-derived (see existing `steer`/`canFork` pattern in `src/agent/acp/index.ts:131-137`).
- Commit after every task (see each task's final step).

---

### Task 1: Backend configuration — `agents.json` + `settings.json`

**Files:**
- Create: `src/agent/backendConfig.ts`
- Create: `src/agent/settingsStore.ts`
- Create: `agents.json.example`
- Modify: `.gitignore` (add `agents.json`, `settings.json` is already runtime data under the workspace dir — see Task 4)
- Test: `src/agent/backendConfig.test.ts`
- Test: `src/agent/settingsStore.test.ts`

**Interfaces:**
- Produces:
  - `interface BackendProfile { name: string; kind: string; command: string; args: string[]; env?: Record<string, string> }`
  - `loadBackendProfiles(configPath: string): Promise<BackendProfile[]>` — throws if the file is missing, malformed, has zero entries, or has duplicate `name`s.
  - `interface SettingsStore { getDefaultBackendName(): string; setDefaultBackendName(name: string): Promise<void> }`
  - `createSettingsStore(opts: { path: string; envDefault: string; validNames: string[] }): Promise<SettingsStore>` — reads `path` (JSON `{ defaultBackendName?: string }`) if present; if the persisted name isn't in `validNames`, falls back to `envDefault`; if `envDefault` also isn't in `validNames`, falls back to `validNames[0]`. `setDefaultBackendName` validates against `validNames`, writes `{ defaultBackendName }` to `path`, and updates the in-memory value.

- [ ] **Step 1: Write the failing test for `loadBackendProfiles`**

```typescript
// src/agent/backendConfig.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadBackendProfiles } from "./backendConfig";

async function withTempFile(content: string, fn: (p: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jb-cfg-"));
  const file = path.join(dir, "agents.json");
  await fs.writeFile(file, content, "utf8");
  try {
    await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("loadBackendProfiles parses a valid file", async () => {
  await withTempFile(
    JSON.stringify({
      backends: [
        { name: "opencode", kind: "opencode", command: "opencode", args: ["acp"] },
        { name: "claude", kind: "claude-acp", command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp@latest"], env: { CLAUDE_CONFIG_DIR: "/tmp/x" } },
      ],
    }),
    async (file) => {
      const profiles = await loadBackendProfiles(file);
      assert.equal(profiles.length, 2);
      assert.equal(profiles[0].name, "opencode");
      assert.equal(profiles[1].env?.CLAUDE_CONFIG_DIR, "/tmp/x");
    },
  );
});

test("loadBackendProfiles rejects duplicate names", async () => {
  await withTempFile(
    JSON.stringify({ backends: [
      { name: "a", kind: "x", command: "x", args: [] },
      { name: "a", kind: "y", command: "y", args: [] },
    ] }),
    async (file) => {
      await assert.rejects(() => loadBackendProfiles(file), /duplicate/i);
    },
  );
});

test("loadBackendProfiles rejects an empty list", async () => {
  await withTempFile(JSON.stringify({ backends: [] }), async (file) => {
    await assert.rejects(() => loadBackendProfiles(file), /at least one/i);
  });
});

test("loadBackendProfiles rejects a missing file with a clear message", async () => {
  await assert.rejects(
    () => loadBackendProfiles("/nonexistent/agents.json"),
    /agents\.json/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern=loadBackendProfiles`
Expected: FAIL with "Cannot find module './backendConfig'"

- [ ] **Step 3: Implement `backendConfig.ts`**

```typescript
// src/agent/backendConfig.ts
// Loads the static, hand-edited list of available agent backends from a
// JSON file (agents.json). Never re-read at runtime beyond process start —
// restart the process to pick up profile changes.

import fs from "node:fs/promises";

export interface BackendProfile {
  name: string;
  kind: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface BackendsFileShape {
  backends?: Array<{
    name?: unknown;
    kind?: unknown;
    command?: unknown;
    args?: unknown;
    env?: unknown;
  }>;
}

export async function loadBackendProfiles(configPath: string): Promise<BackendProfile[]> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (err) {
    throw new Error(
      `could not read agents.json at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: BackendsFileShape;
  try {
    parsed = JSON.parse(raw) as BackendsFileShape;
  } catch (err) {
    throw new Error(`agents.json at ${configPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const entries = parsed.backends;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`agents.json at ${configPath} must list at least one backend under "backends"`);
  }
  const seen = new Set<string>();
  const profiles: BackendProfile[] = entries.map((e, i) => {
    if (typeof e.name !== "string" || !e.name) throw new Error(`backends[${i}].name must be a non-empty string`);
    if (typeof e.kind !== "string" || !e.kind) throw new Error(`backends[${i}].kind must be a non-empty string`);
    if (typeof e.command !== "string" || !e.command) throw new Error(`backends[${i}].command must be a non-empty string`);
    if (!Array.isArray(e.args) || !e.args.every((a) => typeof a === "string")) {
      throw new Error(`backends[${i}].args must be an array of strings`);
    }
    if (seen.has(e.name)) throw new Error(`duplicate backend name in agents.json: ${e.name}`);
    seen.add(e.name);
    const env =
      e.env && typeof e.env === "object"
        ? Object.fromEntries(
            Object.entries(e.env as Record<string, unknown>).filter(
              (kv): kv is [string, string] => typeof kv[1] === "string",
            ),
          )
        : undefined;
    return { name: e.name, kind: e.kind, command: e.command, args: e.args as string[], env };
  });
  return profiles;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern=loadBackendProfiles`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `settingsStore`**

```typescript
// src/agent/settingsStore.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSettingsStore } from "./settingsStore";

async function tmpPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jb-settings-"));
  return path.join(dir, "settings.json");
}

test("seeds from envDefault when no file exists", async () => {
  const p = await tmpPath();
  const store = await createSettingsStore({ path: p, envDefault: "claude", validNames: ["opencode", "claude"] });
  assert.equal(store.getDefaultBackendName(), "claude");
});

test("falls back to validNames[0] when envDefault is not a valid name", async () => {
  const p = await tmpPath();
  const store = await createSettingsStore({ path: p, envDefault: "nonexistent", validNames: ["opencode", "claude"] });
  assert.equal(store.getDefaultBackendName(), "opencode");
});

test("persists setDefaultBackendName and a fresh store picks it up", async () => {
  const p = await tmpPath();
  const store = await createSettingsStore({ path: p, envDefault: "opencode", validNames: ["opencode", "claude"] });
  await store.setDefaultBackendName("claude");
  assert.equal(store.getDefaultBackendName(), "claude");

  const reloaded = await createSettingsStore({ path: p, envDefault: "opencode", validNames: ["opencode", "claude"] });
  assert.equal(reloaded.getDefaultBackendName(), "claude");
});

test("setDefaultBackendName rejects an unknown name", async () => {
  const p = await tmpPath();
  const store = await createSettingsStore({ path: p, envDefault: "opencode", validNames: ["opencode", "claude"] });
  await assert.rejects(() => store.setDefaultBackendName("nope"), /unknown backend/i);
});

test("ignores a persisted name that is no longer valid", async () => {
  const p = await tmpPath();
  await fs.writeFile(p, JSON.stringify({ defaultBackendName: "removed-backend" }), "utf8");
  const store = await createSettingsStore({ path: p, envDefault: "opencode", validNames: ["opencode", "claude"] });
  assert.equal(store.getDefaultBackendName(), "opencode");
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- --test-name-pattern=settingsStore`
Expected: FAIL with "Cannot find module './settingsStore'"

- [ ] **Step 7: Implement `settingsStore.ts`**

```typescript
// src/agent/settingsStore.ts
// Small runtime-mutable settings file (currently just the default backend
// name) living in the workspace dir. Mirrors the existing auto-approve
// pattern: an env var seeds the initial value, the runtime can override it
// without a restart.

import fs from "node:fs/promises";

export interface SettingsStore {
  getDefaultBackendName(): string;
  setDefaultBackendName(name: string): Promise<void>;
}

interface SettingsFileShape {
  defaultBackendName?: string;
}

export async function createSettingsStore(opts: {
  path: string;
  envDefault: string;
  validNames: string[];
}): Promise<SettingsStore> {
  const { path: filePath, envDefault, validNames } = opts;
  let current = validNames.includes(envDefault) ? envDefault : validNames[0];

  let persisted: SettingsFileShape = {};
  try {
    const raw = await fs.readFile(filePath, "utf8");
    persisted = JSON.parse(raw) as SettingsFileShape;
  } catch {
    // Missing or unreadable file — fall through to the env-seeded default.
  }
  if (persisted.defaultBackendName && validNames.includes(persisted.defaultBackendName)) {
    current = persisted.defaultBackendName;
  }

  return {
    getDefaultBackendName(): string {
      return current;
    },
    async setDefaultBackendName(name: string): Promise<void> {
      if (!validNames.includes(name)) {
        throw new Error(`unknown backend name: ${name}`);
      }
      current = name;
      await fs.writeFile(filePath, JSON.stringify({ defaultBackendName: name }, null, 2), "utf8");
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- --test-name-pattern=settingsStore`
Expected: PASS (5 tests)

- [ ] **Step 9: Add `agents.json.example` and gitignore entry**

```json
{
  "backends": [
    { "name": "opencode", "kind": "opencode", "command": "opencode", "args": ["acp"], "env": {} },
    { "name": "claude", "kind": "claude-acp", "command": "npx", "args": ["-y", "@agentclientprotocol/claude-agent-acp@latest"], "env": {} }
  ]
}
```

Save as `agents.json.example` at repo root.

Add to `.gitignore` (after the `.env*` block):
```
# Backend config (machine-specific commands/env) & runtime settings
agents.json
```

- [ ] **Step 10: Commit**

```bash
git add src/agent/backendConfig.ts src/agent/backendConfig.test.ts \
        src/agent/settingsStore.ts src/agent/settingsStore.test.ts \
        agents.json.example .gitignore
git commit -m "feat: add agents.json backend config + settings.json store"
```

---

### Task 2: `AgentCapabilities`/`AgentBackend` type additions

**Files:**
- Modify: `src/agent/types.ts`
- Modify: `test/fixtures/fakeBackend.ts`
- Modify: `frontend/src/api/types.ts`

**Interfaces:**
- Consumes: nothing (pure type addition).
- Produces:
  - `AgentCapabilities` gains `sessionDelete: boolean` and `promptQueueing: boolean`.
  - `AgentBackend` gains optional `deleteSession?(sessionId: string): Promise<void>`.
  - `FakeBackend` (test fixture) accepts `capabilities.sessionDelete`/`capabilities.promptQueueing` overrides via its existing `opts.capabilities` passthrough, and implements a working `deleteSession` for route tests in Task 6.

- [ ] **Step 1: Modify `src/agent/types.ts`**

In the `AgentCapabilities` interface (currently `src/agent/types.ts:4-13`), add two fields:

```typescript
export interface AgentCapabilities {
  multipleSessions: boolean;
  customWorkingDirectory: boolean;
  cancel: boolean;
  steer: boolean;
  toolApprovals: boolean;
  slashCommands: boolean;
  canFork: boolean;
  images: boolean;
  sessionDelete: boolean;
  promptQueueing: boolean;
}
```

In the `AgentBackend` interface (currently `src/agent/types.ts:59-88`), add after `getSlashCommands?`:

```typescript
  deleteSession?(sessionId: string): Promise<void>;
```

- [ ] **Step 2: Update every existing `AgentCapabilities` literal to satisfy the new required fields**

`tsc --noEmit` will fail on every object literal implementing `AgentCapabilities` until updated. Two known call sites:

In `src/agent/acp/index.ts` (constructor, currently lines 89-99), add the two new fields (default `false`; Tasks 7/8 fill in the real derivation):

```typescript
    this.capabilities = {
      multipleSessions: true,
      customWorkingDirectory: true,
      cancel: true,
      steer: false,
      toolApprovals: true,
      slashCommands: false,
      canFork: false,
      images: false,
      sessionDelete: false,
      promptQueueing: false,
    };
```

In `test/fixtures/fakeBackend.ts` (constructor, currently lines 74-84):

```typescript
    this.capabilities = {
      multipleSessions: true,
      customWorkingDirectory: true,
      cancel: true,
      steer: opts.steerSupported ?? true,
      toolApprovals: true,
      slashCommands: (opts.slashCommands ?? []).length > 0,
      canFork: true,
      images: false,
      sessionDelete: opts.capabilities?.sessionDelete ?? false,
      promptQueueing: opts.capabilities?.promptQueueing ?? false,
      ...opts.capabilities,
    };
```

- [ ] **Step 3: Add a working `deleteSession` to `FakeBackend`**

In `test/fixtures/fakeBackend.ts`, add a new public field and method (after `forkSession`, currently around line 124):

```typescript
  public deletedSessions: string[] = [];
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) throw new Error(`unknown session: ${sessionId}`);
    this.sessions.delete(sessionId);
    this.deletedSessions.push(sessionId);
  }
```

- [ ] **Step 4: Mirror the type additions in the frontend**

In `frontend/src/api/types.ts`, add the two fields to `AgentCapabilities` (currently lines 1-10):

```typescript
export interface AgentCapabilities {
  multipleSessions: boolean;
  customWorkingDirectory: boolean;
  cancel: boolean;
  steer: boolean;
  toolApprovals: boolean;
  slashCommands: boolean;
  canFork: boolean;
  images: boolean;
  sessionDelete: boolean;
  promptQueueing: boolean;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (if any other `AgentCapabilities` literal exists that wasn't updated, `tsc` will point at it by file:line — fix inline).

- [ ] **Step 6: Run the existing full test suite to confirm no regressions**

Run: `npm test`
Expected: all existing tests still PASS (the two new capability fields default to `false`, which is a safe no-op for every existing test's assertions).

- [ ] **Step 7: Commit**

```bash
git add src/agent/types.ts test/fixtures/fakeBackend.ts frontend/src/api/types.ts
git commit -m "feat: add sessionDelete/promptQueueing capabilities + deleteSession to AgentBackend"
```

---

### Task 3: Backend registry (multi-backend fan-out)

**Files:**
- Create: `src/agent/backendRegistry.ts`
- Test: `src/agent/backendRegistry.test.ts`

**Interfaces:**
- Consumes: `BackendProfile`/`loadBackendProfiles` (Task 1), `SettingsStore`/`createSettingsStore` (Task 1), `AgentBackend`/`AgentSession`/`ChatSessionSummary` (`src/agent/types.ts`), `createBackendPool`/`BackendPool`/`CreateAgentBackendFn` (`src/agent/backendPool.ts`, unchanged), `createAgentBackend` (`src/agent/index.ts`, unchanged).
- Produces:
  - `interface RegistrySessionEntry { backend: AgentBackend; backendName: string; cwd: string; summary: ChatSessionSummary }`
  - `interface BackendRegistry { getDefaultBackendName(): string; setDefaultBackendName(name: string): Promise<void>; listBackendNames(): string[]; getDefaultBackend(): Promise<AgentBackend>; getBackend(name: string): Promise<AgentBackend>; listSessions(): Promise<RegistrySessionEntry[]>; findSession(sessionId: string): Promise<RegistrySessionEntry | null>; getSession(sessionId: string): Promise<AgentSession | null>; deleteSession(sessionId: string): Promise<void>; shutdown(): Promise<void> }`
  - `createBackendRegistry(opts: { profiles: BackendProfile[]; settings: SettingsStore; workspace: string; logsDir?: string; autoApprove: boolean }): Promise<BackendRegistry>` — eagerly spawns+pools **only** the profile named by `settings.getDefaultBackendName()` (applying `autoApprove` via `setDefaultAutoApprove`); every other profile is spawned lazily on first `getBackend`/`getPool`-driven access and cached thereafter.

- [ ] **Step 1: Write the failing test**

```typescript
// src/agent/backendRegistry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBackendRegistry } from "./backendRegistry";
import { createSettingsStore } from "./settingsStore";
import type { BackendProfile } from "./backendConfig";

const FAKE_AGENT = path.resolve(process.cwd(), "test/fixtures/fake-streaming-agent.cjs");

function profiles(): BackendProfile[] {
  return [
    { name: "opencode", kind: "opencode", command: process.execPath, args: [FAKE_AGENT] },
    { name: "claude", kind: "claude-acp", command: process.execPath, args: [FAKE_AGENT] },
  ];
}

async function mkWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "jb-registry-"));
}

test("eagerly spawns only the default backend", async () => {
  const workspace = await mkWorkspace();
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    const registry = await createBackendRegistry({
      profiles: profiles(),
      settings,
      workspace,
      autoApprove: false,
    });
    assert.equal(registry.listBackendNames().length, 2);
    // Default is resolvable without error and without an explicit getBackend("claude") call yet.
    const def = await registry.getDefaultBackend();
    assert.ok(def);
    await registry.shutdown();
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("getBackend lazily spawns and caches a non-default backend", async () => {
  const workspace = await mkWorkspace();
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    const registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const a = await registry.getBackend("claude");
    const b = await registry.getBackend("claude");
    assert.equal(a, b);
    await registry.shutdown();
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("listSessions/findSession fan out across backends", async () => {
  const workspace = await mkWorkspace();
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    const registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const defaultBackend = await registry.getDefaultBackend();
    const session = await defaultBackend.createSession();

    const found = await registry.findSession(session.id);
    assert.ok(found);
    assert.equal(found?.backendName, "opencode");

    const all = await registry.listSessions();
    assert.ok(all.some((e) => e.summary.sessionId === session.id));

    await registry.shutdown();
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("deleteSession delegates to the owning backend and rejects if unsupported", async () => {
  const workspace = await mkWorkspace();
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    const registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const defaultBackend = await registry.getDefaultBackend();
    const session = await defaultBackend.createSession();
    // fake-streaming-agent.cjs does not advertise sessionCapabilities.delete,
    // so AcpAgentBackend.deleteSession is undefined for this fixture.
    await assert.rejects(() => registry.deleteSession(session.id), /delete not supported/i);
    await registry.shutdown();
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("setDefaultBackendName changes what getDefaultBackend resolves to", async () => {
  const workspace = await mkWorkspace();
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    const registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const before = await registry.getDefaultBackend();
    await registry.setDefaultBackendName("claude");
    const after = await registry.getDefaultBackend();
    assert.notEqual(before, after);
    assert.equal(registry.getDefaultBackendName(), "claude");
    await registry.shutdown();
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="backendRegistry|spawns only the default|lazily spawns|fan out|delegates to the owning|changes what getDefaultBackend"`
Expected: FAIL with "Cannot find module './backendRegistry'"

- [ ] **Step 3: Implement `backendRegistry.ts`**

```typescript
// src/agent/backendRegistry.ts
// Composes one BackendPool per configured agent profile (agents.json) and
// exposes a runtime-mutable "default backend" concept backed by a
// SettingsStore. Only the default profile is spawned eagerly at startup;
// every other profile is spawned lazily on first access and cached.
//
// This is the layer that lets multiple backend *kinds* (opencode, Claude, ...)
// be live concurrently, on top of the existing per-cwd BackendPool which
// only ever pooled one kind at a time.

import { createAgentBackend } from "./index";
import { createBackendPool, type BackendPool, type BackendPoolSessionEntry } from "./backendPool";
import type { BackendProfile } from "./backendConfig";
import type { SettingsStore } from "./settingsStore";
import type { AgentBackend, AgentSession, ChatSessionSummary } from "./types";

export interface RegistrySessionEntry {
  backend: AgentBackend;
  backendName: string;
  cwd: string;
  summary: ChatSessionSummary;
}

export interface BackendRegistry {
  getDefaultBackendName(): string;
  setDefaultBackendName(name: string): Promise<void>;
  listBackendNames(): string[];
  getDefaultBackend(): Promise<AgentBackend>;
  getBackend(name: string): Promise<AgentBackend>;
  listSessions(): Promise<RegistrySessionEntry[]>;
  findSession(sessionId: string): Promise<RegistrySessionEntry | null>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  deleteSession(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export async function createBackendRegistry(opts: {
  profiles: BackendProfile[];
  settings: SettingsStore;
  workspace: string;
  logsDir?: string;
  autoApprove: boolean;
}): Promise<BackendRegistry> {
  const { profiles, settings, workspace, logsDir, autoApprove } = opts;
  const byName = new Map(profiles.map((p) => [p.name, p]));
  const pools = new Map<string, BackendPool>();
  const inFlight = new Map<string, Promise<BackendPool>>();

  async function spawnPool(name: string): Promise<BackendPool> {
    const profile = byName.get(name);
    if (!profile) throw new Error(`unknown backend name: ${name}`);
    const factory = async () =>
      createAgentBackend(
        "chat",
        { command: profile.command, args: profile.args, env: profile.env as NodeJS.ProcessEnv | undefined },
        { workspace, logsDir },
      );
    const backend = await factory();
    backend.setDefaultAutoApprove?.(autoApprove);
    return createBackendPool(backend, workspace, async () => factory());
  }

  async function getPool(name: string): Promise<BackendPool> {
    const cached = pools.get(name);
    if (cached) return cached;
    const pending = inFlight.get(name);
    if (pending) return pending;
    const p = (async () => {
      try {
        const pool = await spawnPool(name);
        pools.set(name, pool);
        return pool;
      } finally {
        inFlight.delete(name);
      }
    })();
    inFlight.set(name, p);
    return p;
  }

  // Eagerly spawn only the current default, mirroring today's single-backend
  // startup behavior (and its healthcheck-before-serving contract in src/index.ts).
  await getPool(settings.getDefaultBackendName());

  return {
    getDefaultBackendName(): string {
      return settings.getDefaultBackendName();
    },
    async setDefaultBackendName(name: string): Promise<void> {
      if (!byName.has(name)) throw new Error(`unknown backend name: ${name}`);
      await settings.setDefaultBackendName(name);
    },
    listBackendNames(): string[] {
      return profiles.map((p) => p.name);
    },
    async getDefaultBackend(): Promise<AgentBackend> {
      const pool = await getPool(settings.getDefaultBackendName());
      return pool.getDefaultBackend();
    },
    async getBackend(name: string): Promise<AgentBackend> {
      const pool = await getPool(name);
      return pool.getDefaultBackend();
    },
    async listSessions(): Promise<RegistrySessionEntry[]> {
      const out: RegistrySessionEntry[] = [];
      for (const name of profiles.map((p) => p.name)) {
        const pool = pools.get(name);
        if (!pool) continue; // never spawned — nothing to list
        const entries: BackendPoolSessionEntry[] = await pool.listSessions();
        for (const e of entries) out.push({ backend: e.backend, backendName: name, cwd: e.cwd, summary: e.summary });
      }
      return out;
    },
    async findSession(sessionId: string): Promise<RegistrySessionEntry | null> {
      const all = await this.listSessions();
      return all.find((e) => e.summary.sessionId === sessionId) ?? null;
    },
    async getSession(sessionId: string): Promise<AgentSession | null> {
      for (const name of profiles.map((p) => p.name)) {
        const pool = pools.get(name);
        if (!pool) continue;
        const s = await pool.getSession(sessionId);
        if (s) return s;
      }
      return null;
    },
    async deleteSession(sessionId: string): Promise<void> {
      const entry = await this.findSession(sessionId);
      if (!entry) throw new Error(`session not found: ${sessionId}`);
      if (!entry.backend.deleteSession) throw new Error(`delete not supported by backend: ${entry.backendName}`);
      await entry.backend.deleteSession(sessionId);
    },
    async shutdown(): Promise<void> {
      for (const pool of pools.values()) {
        for (const backend of pool.listBackends()) {
          await backend.shutdown().catch(() => {});
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="spawns only the default|lazily spawns|fan out|delegates to the owning|changes what getDefaultBackend"`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/backendRegistry.ts src/agent/backendRegistry.test.ts
git commit -m "feat: add BackendRegistry composing multiple BackendPools"
```

---

### Task 4: Wire the registry into startup (`src/index.ts` + `src/config.ts`)

**Files:**
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `loadBackendProfiles` (Task 1), `createSettingsStore` (Task 1), `createBackendRegistry` (Task 3).
- Produces: `AppConfig.agentsConfigPath: string`, `AppConfig.defaultBackendEnv: string | undefined`, `AppConfig.settingsPath: string` (derived from `workspace`) — consumed by Task 5 (server threading) only insofar as `src/index.ts` passes a `registry: BackendRegistry` into `createServer`.

- [ ] **Step 1: Update `src/config.ts`**

Replace the `agent` block in `AppConfig` and its parsing (currently `src/config.ts:7-19` and `36-53`):

```typescript
export interface AppConfig {
  port: number;
  workspace: string;
  agentsConfigPath: string;
  defaultBackendEnv?: string;
  autoApprove: boolean;
  shell: boolean;
  slackToken?: string;
  gatewayUrl: string;
}
```

```typescript
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const workspace = expandHome(
    env.JARVIS_BRIDGE_WORKSPACE ?? "~/.jarvis-bridge",
  );
  const port = Number(env.PORT ?? 3001);
  const agentsConfigPath = env.JARVIS_BRIDGE_AGENTS_CONFIG ?? "./agents.json";
  return {
    port,
    workspace,
    agentsConfigPath,
    defaultBackendEnv: env.JARVIS_BRIDGE_DEFAULT_BACKEND?.trim() || undefined,
    autoApprove: boolOpt(env.AGENT_AUTO_APPROVE),
    shell: boolOpt(env.JARVIS_BRIDGE_SHELL, "false"),
    slackToken: env.SLACK_BOT_TOKEN?.trim() || undefined,
    gatewayUrl: env.JARVIS_BRIDGE_GATEWAY_URL ?? "http://localhost:3001",
  };
}
```

- [ ] **Step 2: Update `src/index.ts` startup sequence**

Replace steps 2–3 (spawn backend + per-cwd pool, currently lines counting from `// 2. Spawn the ACP agent backend...` through the pool construction) with:

```typescript
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { loadBackendProfiles } from "./agent/backendConfig";
import { createSettingsStore } from "./agent/settingsStore";
import { createBackendRegistry } from "./agent/backendRegistry";
import { createServer } from "./server";
import { createToolRegistry } from "./tools";
import { attachTerminalServer } from "./terminal";

async function main(): Promise<void> {
  const cfg = loadConfig();

  // 1. Ensure workspace dir exists (agent cwd + tools realpath root).
  await fs.mkdir(cfg.workspace, { recursive: true });
  console.log(`[jarvis-bridge] workspace ${cfg.workspace}`);

  // 2. Load backend profiles + the runtime default-backend setting.
  const profiles = await loadBackendProfiles(cfg.agentsConfigPath);
  const settings = await createSettingsStore({
    path: path.join(cfg.workspace, "settings.json"),
    envDefault: cfg.defaultBackendEnv ?? profiles[0].name,
    validNames: profiles.map((p) => p.name),
  });

  // 3. Backend registry (eagerly spawns only the current default).
  const registry = await createBackendRegistry({
    profiles,
    settings,
    workspace: cfg.workspace,
    autoApprove: cfg.autoApprove,
  });

  // 4. Healthcheck the default backend.
  const defaultBackend = await registry.getDefaultBackend();
  try {
    const hc = await defaultBackend.healthcheck({ retries: 1 });
    if (!hc.ok) throw new Error(hc.detail ?? "agent healthcheck failed");
  } catch (err) {
    console.error(
      "[jarvis-bridge] agent healthcheck failed:",
      err instanceof Error ? err.message : String(err),
    );
    console.error(
      "[jarvis-bridge] hint: if the agent CLI requires login, run it once in a terminal to authenticate, then retry.",
    );
    await registry.shutdown().catch(() => {});
    process.exit(1);
  }

  // 5. Tools + server.
  const tools = createToolRegistry(cfg.workspace);
  const app = createServer({
    workspace: cfg.workspace,
    port: cfg.port,
    registry,
    tools,
  });
  const server = app.listen(cfg.port, () => {
    console.log(`[jarvis-bridge] gateway listening on http://localhost:${cfg.port}`);
    console.log(`[jarvis-bridge] workspace: ${cfg.workspace}`);
    console.log(`[jarvis-bridge] backends: ${registry.listBackendNames().join(", ")} (default: ${registry.getDefaultBackendName()})`);
  });

  attachTerminalServer({ server, workspace: cfg.workspace, enabled: cfg.shell });
  if (!cfg.shell) {
    console.log("[jarvis-bridge] terminal /terminal disabled (JARVIS_BRIDGE_SHELL=false)");
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[jarvis-bridge] ${signal} received, shutting down`);
    server.close();
    await registry.shutdown().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("[jarvis-bridge] fatal:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
```

Note: this removes the `stubBackend.ts` fallback path (there is always at least one profile in `agents.json`, enforced by Task 1's `loadBackendProfiles` validation) — `src/stubBackend.ts` becomes unused; delete it in this step (`git rm src/stubBackend.ts`) along with any test that imports it (check with `grep -rl stubBackend src/`).

- [ ] **Step 3: Update `.env.example`**

Remove `AGENT_CMD`, `AGENT_ARGS`, `AGENT_MODEL` entries; add:

```
# Backend selection now lives in agents.json (copy agents.json.example -> agents.json
# and edit the command/args/env per backend). These two env vars only seed the
# initial state; both are optional.
JARVIS_BRIDGE_AGENTS_CONFIG=./agents.json
JARVIS_BRIDGE_DEFAULT_BACKEND=opencode
```

- [ ] **Step 4: Typecheck + run full test suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; `src/server.test.ts` will now fail to compile (it still passes `chatBackend`/`backendPool` to `createServer`) — that's expected and fixed in Task 5. If `stubBackend.ts` removal breaks a test, delete that test file too (confirm first with `grep -rl stubBackend src/ test/`).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/index.ts .env.example
git rm -f src/stubBackend.ts 2>/dev/null || true
git commit -m "feat: wire BackendRegistry into startup, replace AGENT_CMD/AGENT_ARGS with agents.json"
```

---

### Task 5: Thread the registry through `server.ts`

**Files:**
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Interfaces:**
- Consumes: `BackendRegistry`/`RegistrySessionEntry` (Task 3).
- Produces: `CreateServerOptions` becomes `{ workspace, port, registry: BackendRegistry, tools }` (drops `chatBackend`, `backendPool`, `autoApprove` — auto-approve default is now applied once per backend inside `createBackendRegistry`, Task 3 Step 3, not in `createServer`).

This task fixes a correctness gap that only matters once a second backend kind exists: routes that need a session's model/capabilities/auto-approve state must resolve the session's **owning** backend (via `registry.findSession`), not a single global `chatBackend` — a session created against the Claude backend must not have its capabilities read off the opencode backend.

- [ ] **Step 1: Update `CreateServerOptions` and the top of `createServer`**

```typescript
import type { BackendRegistry } from "./agent/backendRegistry";

export interface CreateServerOptions {
  workspace: string;
  port: number;
  registry: BackendRegistry;
  tools: Map<string, ToolHandler>;
}
```

```typescript
export function createServer(opts: CreateServerOptions): Express {
  const { workspace, registry, tools } = opts;
  const app = express();
  // ... (chatJson/smallJson unchanged)
```

Remove the old `chatBackend.setDefaultAutoApprove?.(autoApprove.default);` line — auto-approve seeding now happens once per backend inside `createBackendRegistry`.

- [ ] **Step 2: Add two resolution helpers near the existing `resolveSession`/`defaultSessionId` helpers**

```typescript
async function resolveSessionEntry(
  registry: BackendRegistry,
  sessionId: string | undefined,
): Promise<import("./agent/backendRegistry").RegistrySessionEntry | null> {
  if (!sessionId) return null;
  return registry.findSession(sessionId);
}

async function defaultSessionId(registry: BackendRegistry): Promise<string | null> {
  const all = await registry.listSessions();
  return all[0]?.summary.sessionId ?? null;
}

async function resolveSession(
  registry: BackendRegistry,
  sessionId: string | undefined,
): Promise<AgentSession | null> {
  if (!sessionId) return null;
  return registry.getSession(sessionId);
}
```

Delete the old two standalone functions with the same names (currently `src/server.ts:446-463`) — these new versions take `registry` instead of `pool`/`chatBackend`.

- [ ] **Step 3: Update `/health/agent`**

```typescript
  app.get("/health/agent", async (_req, res) => {
    try {
      const backend = await registry.getDefaultBackend();
      const hc = await backend.healthcheck();
      res.json({ agent: hc.ok });
    } catch {
      res.json({ agent: false });
    }
  });
```

- [ ] **Step 4: Update `/chat/init`**

Replace the body (currently `src/server.ts:61-139`). Note this drops the old per-cwd cross-*process* pooling for `/chat/init` specifically — a new session on a different `cwd` now runs in the *same* subprocess as the default backend, passing `cwd` through the ACP `session/new`/`session/load` request instead of spawning a second subprocess pinned to that directory (`createSession`/`loadSession` already accept `{ cwd }` directly, `src/agent/acp/index.ts:306,339`). This matches how the opencode binding doc already says cwd should be threaded — "pass `cwd` via `session/new` instead" (`docs/archives/implementation/10-agent-opencode.md:17`). The old `backendPool.getOrCreate(cwd)` cross-subprocess pooling still exists inside each per-backend `BackendPool` for callers that need an isolated subprocess per directory, but `/chat/init` no longer needs it for the common case:

```typescript
  app.get("/chat/init", smallJson, asyncRoute(async (req, res) => {
    const q = InitQuerySchema.parse(req.query);
    const requestedCwd = q.cwd;
    if (requestedCwd) {
      const stat = await fs.stat(requestedCwd).catch(() => null);
      if (!stat?.isDirectory()) {
        res.status(400).json({ error: "cwd is not a directory" });
        return;
      }
    }
    const backend = await registry.getDefaultBackend();
    let session: AgentSession;
    let resumed = false;
    if (q.sessionId) {
      if (backend.loadSession) {
        session = await backend.loadSession(q.sessionId, requestedCwd ? { cwd: requestedCwd } : undefined);
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
      session = await backend.createSession(requestedCwd ? { cwd: requestedCwd } : undefined);
    }
    const history = session.consumeReplayHistory?.() ?? [];
    const models = backend.getSessionModels?.(session.id) ?? null;
    const slashCommands = session.getSlashCommands
      ? session.getSlashCommands()
      : backend.getSlashCommands
        ? backend.getSlashCommands()
        : [];
    res.json({
      ok: true,
      backend: {
        kind: backend.kind,
        role: backend.role,
        model: models?.current ?? null,
      },
      sessionId: session.id,
      cwd: requestedCwd ?? workspace,
      resumed,
      history,
      capabilities: backend.capabilities,
      slashCommands,
      autoApprove: {
        supported: true,
        default: backend.getDefaultAutoApprove?.() ?? false,
        override: backend.getSessionAutoApproveOverride?.(session.id) ?? null,
        effective:
          backend.getSessionAutoApproveOverride?.(session.id) ??
          backend.getDefaultAutoApprove?.() ??
          false,
        enabled:
          backend.getSessionAutoApproveOverride?.(session.id) ??
          backend.getDefaultAutoApprove?.() ??
          false,
      },
      model: models
        ? { supported: true, available: models.available, current: models.current }
        : { supported: false, available: [], current: null },
    });
  }));
```

- [ ] **Step 5: Update `/chat/send`**

```typescript
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
    // ... (SSE streaming body unchanged from here)
```

- [ ] **Step 6: Update `/chat/cancel`, `/chat/approval`**

Both just swap `backendPool` → `registry` in the `resolveSession(...)` call — no other changes:

```typescript
  app.post("/chat/cancel", smallJson, asyncRoute(async (req, res) => {
    const body = CancelBodySchema.parse(req.body ?? {});
    const session = await resolveSession(registry, body.sessionId);
    if (session) await session.cancel();
    res.json({ ok: true });
  }));

  app.post("/chat/approval", smallJson, asyncRoute(async (req, res) => {
    const body = ApprovalBodySchema.parse(req.body ?? {});
    const session = await resolveSession(registry, body.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const ok = session.resolveApproval ? session.resolveApproval(body.requestId, body.optionId) : false;
    if (!ok) {
      res.status(409).json({ error: "no pending approval" });
      return;
    }
    res.json({ ok: true });
  }));
```

- [ ] **Step 7: Update `/chat/steer` to resolve the owning backend's capability, not a global one**

```typescript
  app.post("/chat/steer", smallJson, asyncRoute(async (req, res) => {
    const body = SteerBodySchema.parse(req.body ?? {});
    const entry = await resolveSessionEntry(registry, body.sessionId);
    if (!entry?.summary || !entry.backend.capabilities.steer) {
      res.json({ ok: true, accepted: false, reason: "unsupported" });
      return;
    }
    const session = await registry.getSession(body.sessionId ?? "");
    if (!session?.steer) {
      res.json({ ok: true, accepted: false, reason: "unsupported" });
      return;
    }
    const result = await session.steer(body.prompt);
    res.json({ ok: true, accepted: result.accepted, reason: result.reason });
  }));
```

- [ ] **Step 8: Update `/chat/model` GET/POST to use the owning backend**

```typescript
  app.get("/chat/model", smallJson, asyncRoute(async (req, res) => {
    const q = ModelQuerySchema.parse(req.query);
    const entry = await resolveSessionEntry(registry, q.sessionId);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const info = entry.backend.getSessionModels?.(entry.summary.sessionId);
    if (!info) {
      res.json({ ok: true, supported: false, available: [], current: null });
      return;
    }
    res.json({ ok: true, supported: true, available: info.available, current: info.current });
  }));

  app.post("/chat/model", smallJson, asyncRoute(async (req, res) => {
    const body = ModelPostBodySchema.parse(req.body ?? {});
    const entry = await resolveSessionEntry(registry, body.sessionId);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    if (!entry.backend.setSessionModel) {
      res.status(501).json({ error: "model switching not supported" });
      return;
    }
    try {
      await entry.backend.setSessionModel(body.sessionId, body.modelId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  }));
```

- [ ] **Step 9: Update `/chat/auto-approve` GET/POST**

The no-`sessionId` "backend-wide default" case now targets `registry.getDefaultBackend()` specifically (preserves today's semantics for the common single-backend-in-view case):

```typescript
  app.get("/chat/auto-approve", smallJson, asyncRoute(async (req, res) => {
    const q = AutoApproveQuerySchema.parse(req.query);
    if (!q.sessionId) {
      const backend = await registry.getDefaultBackend();
      const def = backend.getDefaultAutoApprove?.() ?? false;
      res.json({ ok: true, supported: true, default: def, override: null, effective: def, enabled: def });
      return;
    }
    const entry = await resolveSessionEntry(registry, q.sessionId);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const def = entry.backend.getDefaultAutoApprove?.() ?? false;
    const ov = entry.backend.getSessionAutoApproveOverride?.(q.sessionId);
    res.json({ ok: true, supported: true, default: def, override: ov ?? null, effective: ov ?? def, enabled: ov ?? def });
  }));

  app.post("/chat/auto-approve", smallJson, asyncRoute(async (req, res) => {
    const body = AutoApprovePostBodySchema.parse(req.body ?? {});
    if (!body.sessionId) {
      const backend = await registry.getDefaultBackend();
      backend.setDefaultAutoApprove?.(Boolean(body.enabled));
      const def = backend.getDefaultAutoApprove?.() ?? false;
      res.json({ ok: true, supported: true, default: def, override: null, effective: def, enabled: def });
      return;
    }
    const entry = await resolveSessionEntry(registry, body.sessionId);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    entry.backend.setSessionAutoApprove?.(body.sessionId, body.enabled);
    const def = entry.backend.getDefaultAutoApprove?.() ?? false;
    const ov = entry.backend.getSessionAutoApproveOverride?.(body.sessionId);
    res.json({ ok: true, supported: true, default: def, override: ov ?? null, effective: ov ?? def, enabled: ov ?? def });
  }));
```

- [ ] **Step 10: Update `/chat/sessions` GET and `/chat/sessions/fork`**

```typescript
  app.get("/chat/sessions", smallJson, asyncRoute(async (_req, res) => {
    const all = await registry.listSessions();
    const active = await defaultSessionId(registry);
    const sessions = all.map((e) => ({
      sessionId: e.summary.sessionId,
      title: e.summary.title,
      updatedAt: e.summary.updatedAt ?? null,
      cwd: e.cwd,
      backendName: e.backendName,
      customTitle: sessionMeta.get(e.summary.sessionId)?.customTitle,
      pinned: sessionMeta.get(e.summary.sessionId)?.pinned,
      group: sessionMeta.get(e.summary.sessionId)?.group,
      active: e.summary.sessionId === active,
    }));
    res.json({ sessions });
  }));

  app.post("/chat/sessions/fork", smallJson, asyncRoute(async (req, res) => {
    const body = ForkBodySchema.parse(req.body ?? {});
    const entry = await resolveSessionEntry(registry, body.sessionId);
    if (!entry) {
      res.status(404).json({ error: "source session not found" });
      return;
    }
    if (!entry.backend.forkSession) {
      res.status(501).json({ error: "fork not supported" });
      return;
    }
    const forked = await entry.backend.forkSession(body.sessionId);
    res.json({ ok: true, sourceSessionId: body.sessionId, sessionId: forked.id, cwd: workspace });
  }));
```

`/chat/sessions/:sessionId` PATCH (gateway-side metadata only) is unchanged — it never touched `chatBackend`/`backendPool`.

- [ ] **Step 11: Update `src/server.test.ts`'s `withServer` helper**

```typescript
import { createBackendRegistry } from "./agent/backendRegistry";
import { createSettingsStore } from "./agent/settingsStore";

async function withServer<T>(
  setup: (workspace: string) => Promise<{
    backend: FakeBackend;
    fn: (url: string) => Promise<T>;
  }>,
): Promise<T> {
  const ws = await mkWorkspace();
  try {
    const { backend, fn } = await setup(ws);
    const settings = await createSettingsStore({
      path: `${ws}/settings.json`,
      envDefault: "fake",
      validNames: ["fake"],
    });
    const registry = await createBackendRegistry({
      profiles: [{ name: "fake", kind: "fake", command: "true", args: [] }],
      settings,
      workspace: ws,
      autoApprove: false,
    });
    // Swap in the caller-supplied FakeBackend as the eagerly-spawned default's
    // pool's default backend, since createBackendRegistry would otherwise try
    // to spawn `command: "true"` for real. Simplest correct approach: bypass
    // createBackendRegistry's spawn path entirely for tests and build a
    // registry-shaped object directly around the one FakeBackend, matching
    // what createBackendRegistry exposes.
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

function makeSingleBackendTestRegistry(backend: FakeBackend): import("./agent/backendRegistry").BackendRegistry {
  return {
    getDefaultBackendName: () => "fake",
    setDefaultBackendName: async () => {},
    listBackendNames: () => ["fake"],
    getDefaultBackend: async () => backend,
    getBackend: async () => backend,
    listSessions: async () => {
      const sessions = await backend.listSessions();
      return sessions.map((summary) => ({ backend, backendName: "fake", cwd: "", summary }));
    },
    findSession: async (sessionId: string) => {
      const s = backend.getSession(sessionId);
      if (!s) return null;
      return { backend, backendName: "fake", cwd: "", summary: { sessionId } };
    },
    getSession: async (sessionId: string) => backend.getSession(sessionId),
    deleteSession: async (sessionId: string) => {
      if (!backend.deleteSession) throw new Error("delete not supported by backend: fake");
      await backend.deleteSession(sessionId);
    },
    shutdown: async () => {},
  };
}
```

Delete the now-unused `createBackendPool` import at the top of `src/server.test.ts`.

- [ ] **Step 12: Run the full existing server test suite**

Run: `npm test -- --test-name-pattern=""` (or just `npm test`)
Expected: every pre-existing `server.test.ts` test still PASSes unmodified (they only ever depended on `FakeBackend` behavior, which is unchanged) — confirms the registry-threading refactor is behavior-preserving for the single-backend case.

- [ ] **Step 13: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "refactor: thread BackendRegistry through server.ts, resolve owning backend per session"
```

---

### Task 6: New routes — `DELETE /chat/sessions/:id`, `GET`/`PUT /settings/default-backend`

**Files:**
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Interfaces:**
- Consumes: `registry.deleteSession`, `registry.listBackendNames`, `registry.getDefaultBackendName`, `registry.setDefaultBackendName` (all from Task 3/5).
- Produces: two new HTTP endpoints consumed by Tasks 12/13 (frontend).

- [ ] **Step 1: Write the failing tests**

Add to `src/server.test.ts`:

```typescript
test("DELETE /chat/sessions/:id calls backend.deleteSession and returns ok", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const created = await fetch(`${url}/chat/init`).then((r) => r.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/sessions/${created.sessionId}`, { method: "DELETE" });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    },
  }));
});

test("DELETE /chat/sessions/:id returns 404 for an unknown session", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/sessions/does-not-exist`, { method: "DELETE" });
      assert.equal(res.status, 404);
    },
  }));
});

test("GET /settings/default-backend returns the available names and current default", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/settings/default-backend`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; available: string[]; default: string };
      assert.equal(body.ok, true);
      assert.deepEqual(body.available, ["fake"]);
      assert.equal(body.default, "fake");
    },
  }));
});

test("PUT /settings/default-backend rejects an unknown name", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/settings/default-backend`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "nonexistent" }),
      });
      assert.equal(res.status, 400);
    },
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="DELETE /chat/sessions|default-backend"`
Expected: FAIL — 404 "not found" for both new routes (Express has no handler yet).

- [ ] **Step 3: Implement the routes**

Add near the other `/chat/sessions/*` routes in `src/server.ts` (after the `PATCH /chat/sessions/:sessionId` handler):

```typescript
  app.delete("/chat/sessions/:sessionId", smallJson, asyncRoute(async (req, res) => {
    const sid = req.params.sessionId;
    try {
      await registry.deleteSession(sid);
      sessionMeta.delete(sid);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(message)) {
        res.status(404).json({ error: message });
      } else if (/not supported/i.test(message)) {
        res.status(501).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  }));
```

Add near `/status/active` (a new section, before `// ── Workspace ──`):

```typescript
  // ── Settings ──────────────────────────────────────────────────────
  app.get("/settings/default-backend", smallJson, (_req, res) => {
    res.json({
      ok: true,
      available: registry.listBackendNames(),
      default: registry.getDefaultBackendName(),
    });
  });

  app.put("/settings/default-backend", smallJson, asyncRoute(async (req, res) => {
    const body = SetDefaultBackendBodySchema.parse(req.body ?? {});
    try {
      await registry.setDefaultBackendName(body.name);
      res.json({ ok: true, default: registry.getDefaultBackendName() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  }));
```

Add the schema near the other Zod schemas:

```typescript
const SetDefaultBackendBodySchema = z.object({ name: z.string().min(1) });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="DELETE /chat/sessions|default-backend"`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: add DELETE /chat/sessions/:id and GET/PUT /settings/default-backend routes"
```

---

### Task 7: ACP backend — `sessionDelete` capability + `deleteSession()`

**Files:**
- Modify: `src/agent/acp/index.ts`
- Modify: `test/fixtures/fake-streaming-agent.cjs`
- Modify: `src/agent/acp/index.test.ts`

**Interfaces:**
- Consumes: `AgentCapabilities.sessionDelete`, `AgentBackend.deleteSession?` (Task 2).
- Produces: `AcpAgentBackend.deleteSession(sessionId): Promise<void>` — only assigned as a real method when the handshake advertised `sessionCapabilities.delete`; otherwise the property stays absent so `registry.deleteSession`'s `!entry.backend.deleteSession` check (Task 3) correctly reports "not supported."

- [ ] **Step 1: Extend the fake agent fixture**

In `test/fixtures/fake-streaming-agent.cjs`, add an env-var-controlled capability and a `session/delete` handler:

```javascript
// Near the top, alongside the other env var reads:
const advertiseDelete = process.env.X_FAKE_AGENT_SESSION_DELETE === "true";
```

In the `initialize` case, make `sessionCapabilities` conditional:

```javascript
    case "initialize":
      reply(msg.id, {
        protocolVersion: 1,
        agentCapabilities: {
          promptCapabilities: { image: true },
          sessionCapabilities: advertiseDelete ? { fork: {}, delete: {} } : { fork: {} },
          extensions: { "jarvis-bridge/steer": {} },
        },
        agentInfo: { name: "fake-agent", version: "0.0.1" },
      });
      break;
```

Add a new case in the `switch (msg.method)`:

```javascript
    case "session/delete":
      reply(msg.id, {});
      break;
```

- [ ] **Step 2: Write the failing test**

Add to `src/agent/acp/index.test.ts`:

```typescript
test("sessionDelete capability is false when the agent does not advertise sessionCapabilities.delete", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
  });
  try {
    assert.equal(backend.capabilities.sessionDelete, false);
    const session = await backend.createSession();
    await assert.rejects(() => backend.deleteSession(session.id), /delete not supported/i);
  } finally {
    await backend.shutdown();
  }
});

test("sessionDelete capability is true and deleteSession calls session/delete when advertised", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: { ...process.env, X_FAKE_AGENT_SESSION_DELETE: "true" },
  });
  try {
    assert.equal(backend.capabilities.sessionDelete, true);
    const session = await backend.createSession();
    await backend.deleteSession(session.id);
  } finally {
    await backend.shutdown();
  }
});
```

(Adjust the exact `AcpAgentBackend.spawn` call/import to match however `index.test.ts` already imports it — check the file's existing top-of-file imports and reuse its `FAKE_AGENT` constant rather than redefining it.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --test-name-pattern=sessionDelete`
Expected: FAIL — `capabilities.sessionDelete` is `undefined`/not derived yet, and `deleteSession` doesn't exist on the class.

- [ ] **Step 4: Implement in `src/agent/acp/index.ts`**

In `connect()` (currently lines 114-137), extend the capability-derivation block:

```typescript
    const caps = initRes.agentCapabilities ?? {};
    const hasExtension = (obj: unknown, key: string): boolean =>
      typeof obj === "object" && obj !== null && key in (obj as Record<string, unknown>);
    const steer = hasExtension(caps.extensions, STEER_EXTENSION_KEY);
    const canFork = hasExtension(caps.sessionCapabilities, "fork");
    const sessionDelete = hasExtension(caps.sessionCapabilities, "delete");
    const images = caps.promptCapabilities?.image === true;

    this.capabilities.steer = steer;
    this.capabilities.canFork = canFork;
    this.capabilities.sessionDelete = sessionDelete;
    this.capabilities.images = images;
```

Also widen the `initRes` cast's `sessionCapabilities` typing isn't needed (already `Record<string, unknown>` — `delete` just needs to be a key present at runtime, which `hasExtension` already checks generically).

Follow the exact pattern `forkSession` already establishes in this class (`src/agent/acp/index.ts:395-409`): the method is **always** defined on the class (satisfies the interface unconditionally), and throws its own "not supported" error at call time when the capability is false, rather than trying to make the method itself conditionally absent. Add it to the class body, right after `forkSession`:

```typescript
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.capabilities.sessionDelete) throw new Error("delete not supported by this agent");
    await this.conn.sendRequest("session/delete", { sessionId });
    this.sessions.delete(sessionId);
    this.sessionObjects.delete(sessionId);
  }
```

(`BackendRegistry.deleteSession`, Task 3, checks `!entry.backend.deleteSession` before calling — that check is always `false` here since the method is always defined, matching how `registry`'s own fallback branch is effectively unreachable for this backend; the real "not supported" signal comes from this method's own thrown error, which is why Task 3's test asserts on the message pattern `/delete not supported/i` rather than on which layer raised it.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --test-name-pattern=sessionDelete`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all PASS (existing tests use the fixture without `X_FAKE_AGENT_SESSION_DELETE`, so `sessionCapabilities.delete` stays absent for them — unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/agent/acp/index.ts src/agent/acp/index.test.ts test/fixtures/fake-streaming-agent.cjs
git commit -m "feat: derive sessionDelete capability and implement AcpAgentBackend.deleteSession"
```

---

### Task 8: ACP backend — `promptQueueing` capability + busy-gate relaxation

**Files:**
- Modify: `src/agent/acp/index.ts`
- Modify: `test/fixtures/fake-streaming-agent.cjs`
- Modify: `src/agent/acp/index.test.ts`

**Interfaces:**
- Consumes: `AgentCapabilities.promptQueueing` (Task 2).
- Produces: when `promptQueueing` is true, `AcpAgentSession.sendMessage` no longer rejects a second call while the session is busy — it enqueues the call and its own async generator starts draining once the prior turn (and any turns ahead of it in the queue) completes. When `false` (opencode, and the fixture's default), behavior is byte-for-byte unchanged from today (immediate `{type:"error", message:"session is busy"}`).

- [ ] **Step 1: Extend the fake agent fixture to support concurrent `session/prompt` calls**

The fixture already replies to `session/prompt` independently per request `id`, keyed correctly since `handlePrompt` closes over its own `id`/`sessionId` args — it already supports multiple concurrent in-flight prompts at the JSON-RPC transport level (nothing serializes them today). Add the capability flag:

```javascript
const advertisePromptQueueing = process.env.X_FAKE_AGENT_PROMPT_QUEUEING === "true";
```

In the `initialize` case:

```javascript
    case "initialize":
      reply(msg.id, {
        protocolVersion: 1,
        agentCapabilities: {
          promptCapabilities: { image: true },
          sessionCapabilities: advertiseDelete ? { fork: {}, delete: {} } : { fork: {} },
          extensions: { "jarvis-bridge/steer": {} },
          ...(advertisePromptQueueing ? { _meta: { claudeCode: { promptQueueing: true } } } : {}),
        },
        agentInfo: { name: "fake-agent", version: "0.0.1" },
      });
      break;
```

To make a test able to observe ordering, add an env var that tags each reply with an incrementing sequence number distinguishable per call:

```javascript
let promptSeq = 0;
```

and in `handlePrompt`, include `promptSeq++` in the final `reply(id, { stopReason: "end_turn", usage: {...}, _meta: { seq: promptSeq } })` — actually simplest: rely on the existing `newText` env var differing per test invocation isn't possible mid-test since the fixture is a single spawned process; instead have the test assert ordering via the **content** of two different prompts by racing `session.sendMessage("first")` then immediately `session.sendMessage("second")` and checking that the returned patches for "first" fully appear (including its terminal `done`) before "second"'s do, using the existing `X_FAKE_AGENT_DELAY_MS`/per-chunk delay to make ordering observable. No fixture change needed beyond the capability flag — remove the unused `promptSeq` idea.

- [ ] **Step 2: Write the failing tests**

Add to `src/agent/acp/index.test.ts`:

```typescript
test("busy gate rejects a second sendMessage when promptQueueing is not advertised", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: { ...process.env, X_FAKE_AGENT_DELAY_MS: "200" },
  });
  try {
    const session = await backend.createSession();
    const first = session.sendMessage("first");
    const firstIter = first[Symbol.asyncIterator]();
    await firstIter.next(); // start draining, session becomes busy

    const secondPatches: unknown[] = [];
    for await (const p of session.sendMessage("second")) secondPatches.push(p);
    assert.deepEqual(secondPatches, [{ type: "error", message: "session is busy" }]);

    // Drain the first turn to completion so the process can shut down cleanly.
    for await (const _p of { [Symbol.asyncIterator]: () => firstIter }) { /* drain */ }
  } finally {
    await backend.shutdown();
  }
});

test("promptQueueing capability is true when the agent advertises _meta.claudeCode.promptQueueing", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: { ...process.env, X_FAKE_AGENT_PROMPT_QUEUEING: "true" },
  });
  try {
    assert.equal(backend.capabilities.promptQueueing, true);
  } finally {
    await backend.shutdown();
  }
});

test("a queued sendMessage drains in FIFO order when promptQueueing is advertised", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: {
      ...process.env,
      X_FAKE_AGENT_PROMPT_QUEUEING: "true",
      X_FAKE_AGENT_DELAY_MS: "100",
    },
  });
  try {
    const session = await backend.createSession();
    const order: string[] = [];
    const firstDone = (async () => {
      for await (const p of session.sendMessage("first")) {
        if ((p as { type?: string }).type === "done") order.push("first-done");
      }
    })();
    // Give the first call a moment to actually start (become busy) before queuing the second.
    await new Promise((r) => setTimeout(r, 20));
    const secondDone = (async () => {
      for await (const p of session.sendMessage("second")) {
        if ((p as { type?: string }).type === "done") order.push("second-done");
      }
    })();
    await Promise.all([firstDone, secondDone]);
    assert.deepEqual(order, ["first-done", "second-done"]);
  } finally {
    await backend.shutdown();
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="promptQueueing|busy gate"`
Expected: the first test PASSes already (no behavior change needed for the false case — confirms no regression); the second FAILs (`promptQueueing` not derived); the third FAILs (`second` gets `"session is busy"` instead of queueing).

- [ ] **Step 4: Derive the capability in `connect()`**

Add alongside the other capability derivations in `src/agent/acp/index.ts`:

```typescript
    interface AgentCapsWithMeta {
      _meta?: { claudeCode?: { promptQueueing?: boolean } };
    }
    const promptQueueing = (caps as AgentCapsWithMeta)._meta?.claudeCode?.promptQueueing === true;
    this.capabilities.promptQueueing = promptQueueing;
```

(Widen the `initRes` cast type at the top of `connect()`, currently lines 120-126, to include `_meta?: { claudeCode?: { promptQueueing?: boolean } }` alongside `agentCapabilities`.)

- [ ] **Step 5: Implement FIFO queueing in `AcpAgentSession.sendMessage`**

This is the substantial change. Replace the busy-guard at the top of `sendMessage` (currently `src/agent/acp/index.ts:613-621`) and add a queue mechanism. Add a new private field to `AcpAgentSession`:

```typescript
export class AcpAgentSession implements AgentSession {
  readonly id: string;
  private backend: AcpAgentBackend;
  private ctx: SessionContext;
  private closed = false;
  private turnQueue: Array<() => void> = []; // resolves the next queued caller's "go ahead" gate
```

Replace the guard + immediately-following busy-set (currently lines 613-623):

```typescript
    if (this.closed) {
      yield { type: "error", message: "session is closed" };
      return;
    }
    if (this.ctx.busy) {
      if (!this.backend.capabilities.promptQueueing) {
        yield { type: "error", message: "session is busy" };
        return;
      }
      // Queue behind the in-flight turn; wait for our turn.
      await new Promise<void>((resolve) => this.turnQueue.push(resolve));
    }
    this.ctx.busy = true;
    this.ctx.cancelRequested = false;
    resetTurnState(this.ctx.state);
```

And in the `finally` block at the end of `sendMessage` (currently lines 707-710), release the next queued caller instead of just clearing `busy`:

```typescript
    } finally {
      this.ctx.busy = false;
      this.ctx.onPatch = null;
      const next = this.turnQueue.shift();
      if (next) next(); // wake the next queued sendMessage call, if any
    }
```

This preserves correctness because: (1) each queued caller's generator body doesn't start executing (including `resetTurnState`/pump setup) until its `await new Promise(...)` resolves, which only happens after the prior turn's `finally` runs; (2) FIFO ordering falls out of `Array.push`/`Array.shift`; (3) when `promptQueueing` is `false`, the `if (this.ctx.busy)` branch takes the original immediate-reject path, byte-for-byte unchanged.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="promptQueueing|busy gate"`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/agent/acp/index.ts src/agent/acp/index.test.ts test/fixtures/fake-streaming-agent.cjs
git commit -m "feat: derive promptQueueing capability, relax busy-gate to FIFO queue when supported"
```

---

### Task 9: Generalized session config parsing (`modes` + `configOptions`)

**Files:**
- Modify: `src/agent/acp/index.ts`
- Modify: `test/fixtures/fake-streaming-agent.cjs`
- Modify: `src/agent/acp/index.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SessionContext` gains optional `rawConfigOptions` and `modes` fields (captured, not exposed via any new getter/route yet — Phase 2 adds pickers). `parseModels` is renamed `parseSessionConfig` and additionally accepts a `modes` field on the `session/new`/`session/load` response without breaking its existing `{available, current}` model-parsing contract (same return shape for `.models`, plus new `.rawConfigOptions`/`.modes` — existing callers `getSessionModels`/`setSessionModel` only ever read `.models`, so no call-site changes needed beyond consuming the renamed function).

- [ ] **Step 1: Extend the fake agent fixture to optionally return a split `modes`+`configOptions` shape**

```javascript
const claudeStyleConfig = process.env.X_FAKE_AGENT_CLAUDE_STYLE_CONFIG === "true";
```

In `session/new` (and mirror in `session/load`):

```javascript
    case "session/new":
      reply(msg.id, claudeStyleConfig
        ? {
            sessionId: makeSessionId(),
            modes: { currentModeId: "default", availableModes: [{ id: "default" }, { id: "plan" }] },
            configOptions: [
              { id: "model", currentValue: "claude-fake", options: [{ value: "claude-fake", name: "Claude Fake" }] },
              { id: "effort", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
            ],
          }
        : {
            sessionId: makeSessionId(),
            configOptions: [
              {
                id: "model",
                currentValue: "fake-model",
                options: [
                  { value: "fake-model", name: "Fake Model" },
                  { value: "another", name: "Another Model" },
                ],
              },
            ],
          });
      break;
```

- [ ] **Step 2: Write the failing test**

Add to `src/agent/acp/index.test.ts`:

```typescript
test("createSession captures modes and non-model configOptions without dropping them", async () => {
  const backend = await AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: { ...process.env, X_FAKE_AGENT_CLAUDE_STYLE_CONFIG: "true" },
  });
  try {
    const session = await backend.createSession();
    // Existing model-parsing contract still works:
    const models = backend.getSessionModels(session.id);
    assert.equal(models?.current, "claude-fake");
    assert.equal(models?.available.length, 1);
    // New: raw configOptions/modes are captured on the internal context
    // (exposed here via a package-private accessor added for this test).
    const raw = backend.getSessionRawConfig(session.id);
    assert.equal(raw?.modes?.currentModeId, "default");
    assert.equal(raw?.rawConfigOptions?.find((o) => o.id === "effort")?.currentValue, "medium");
  } finally {
    await backend.shutdown();
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="modes and non-model"`
Expected: FAIL — `getSessionRawConfig` doesn't exist yet.

- [ ] **Step 4: Implement in `src/agent/acp/index.ts`**

Extend `SessionContext` (currently lines 45-65):

```typescript
interface SessionContext {
  // ... existing fields unchanged ...
  rawConfigOptions?: Array<{ id: string; currentValue?: string; options: Array<{ value?: string; name?: string }> }>;
  modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name?: string }> };
}
```

Rename `parseModels` to `parseSessionConfig` and widen its input/output (currently lines 558-569):

```typescript
interface SessionConfigResponse {
  configOptions?: Array<{
    id?: string;
    currentValue?: string;
    options?: Array<{ value?: string; name?: string }>;
  }>;
  modes?: { currentModeId?: string; availableModes?: Array<{ id?: string; name?: string }> };
}

function parseSessionConfig(res: SessionConfigResponse | undefined): {
  models: { available: Array<{ modelId: string; name: string }>; current: string };
  rawConfigOptions: Array<{ id: string; currentValue?: string; options: Array<{ value?: string; name?: string }> }>;
  modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name?: string }> };
} {
  const opts = res?.configOptions;
  const rawConfigOptions = (opts ?? [])
    .filter((o): o is { id: string; currentValue?: string; options?: Array<{ value?: string; name?: string }> } => typeof o.id === "string")
    .map((o) => ({ id: o.id, currentValue: o.currentValue, options: o.options ?? [] }));
  const modelOpt = rawConfigOptions.find((o) => o.id === "model");
  const available = (modelOpt?.options ?? [])
    .filter((o): o is { value: string; name?: string } => typeof o.value === "string")
    .map((o) => ({ modelId: o.value, name: o.name ?? o.value }));
  const models = { available, current: modelOpt?.currentValue ?? available[0]?.modelId ?? "" };
  const modesOut = res?.modes
    ? {
        currentModeId: res.modes.currentModeId,
        availableModes: (res.modes.availableModes ?? [])
          .filter((m): m is { id: string; name?: string } => typeof m.id === "string"),
      }
    : undefined;
  return { models, rawConfigOptions, modes: modesOut };
}
```

Update `createSession` and `loadSession` call sites (currently `res.configOptions` typed inline + `parseModels(res.configOptions)`, lines ~308-324 and ~354-367) to widen their response cast to include `modes`, and to store the extra fields:

```typescript
    const res = (await this.conn.sendRequest("session/new", { cwd, mcpServers: [] })) as SessionConfigResponse & { sessionId?: string };
    const sessionId = res.sessionId;
    if (!sessionId) throw new Error("agent did not return a sessionId");
    const ctx = this.makeSessionContext();
    const parsed = parseSessionConfig(res);
    ctx.availableModels = parsed.models.available;
    ctx.currentModelId = parsed.models.current;
    ctx.rawConfigOptions = parsed.rawConfigOptions;
    ctx.modes = parsed.modes;
```

(Apply the equivalent three-line change — `parseSessionConfig(res)` then set `rawConfigOptions`/`modes` — in `loadSession` too.)

Add a package-private accessor (test-only surface, mirrors `getSpawnOptions`'s "internal helpers" section):

```typescript
  getSessionRawConfig(sessionId: string): { rawConfigOptions?: SessionContext["rawConfigOptions"]; modes?: SessionContext["modes"] } | null {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return null;
    return { rawConfigOptions: ctx.rawConfigOptions, modes: ctx.modes };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="modes and non-model"`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all PASS — the default (non-`X_FAKE_AGENT_CLAUDE_STYLE_CONFIG`) fixture path exercises the unchanged flat-`configOptions`-only branch, so existing model-parsing tests are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/agent/acp/index.ts src/agent/acp/index.test.ts test/fixtures/fake-streaming-agent.cjs
git commit -m "feat: generalize session config parsing to capture modes + non-model configOptions"
```

---

### Task 10: Claude backend profile — spawn resolution + auth healthcheck hint

**Files:**
- Modify: `agents.json.example`
- Modify: `package.json` (`engines.node`)
- Modify: `src/index.ts` (healthcheck-failure hint)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed by later tasks — this task is about the shipped default config and error messaging.

- [ ] **Step 1: Bump the Node engine floor**

In `package.json`, change:

```json
  "engines": { "node": ">=20" }
```
to:
```json
  "engines": { "node": ">=22" }
```

(`@agentclientprotocol/claude-agent-acp`'s own `package.json` requires `"node": ">=22"` — see `~/Desktop/opensource/claude-code-acp/package.json:63`.)

- [ ] **Step 2: Finalize the Claude entry in `agents.json.example`**

Prefer a locally-installed binary on `PATH`, falling back to `npx`, by using a small shell wrapper rather than baking the fallback logic into jarvis_bridge's spawn code (keeps `backendConfig.ts` free of resolution logic, matching the opencode profile's simplicity — opencode's binding doc resolves `which opencode` at the *shell* level too, not in jarvis_bridge code):

```json
{
  "backends": [
    { "name": "opencode", "kind": "opencode", "command": "opencode", "args": ["acp"], "env": {} },
    {
      "name": "claude",
      "kind": "claude-acp",
      "command": "npx",
      "args": ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
      "env": {}
    }
  ]
}
```

Add a comment-equivalent note directly in the repo (since JSON has no comments) — add a short section to `docs/agent-claude-code.md` (written in Task 11) explaining that users with `claude-agent-acp` installed globally should replace `command`/`args` with `{"command": "claude-agent-acp", "args": []}` to skip the `npx` cold-start, and that `CLAUDE_CONFIG_DIR` can be added under `env` for a non-default credential store location.

- [ ] **Step 3: Update the healthcheck-failure hint in `src/index.ts`**

The current hint (from Task 4's Step 2) is generic ("if the agent CLI requires login, run it once in a terminal to authenticate, then retry"). Make it backend-aware using the resolved default backend's `kind` isn't available post-hoc without extra plumbing — simplest correct fix: read the default profile's `kind` from `profiles` (already in scope in `main()`) and branch the *message only* (not behavior) on it:

```typescript
  } catch (err) {
    console.error(
      "[jarvis-bridge] agent healthcheck failed:",
      err instanceof Error ? err.message : String(err),
    );
    const defaultProfile = profiles.find((p) => p.name === settings.getDefaultBackendName());
    if (defaultProfile?.kind === "claude-acp") {
      console.error(
        "[jarvis-bridge] hint: the Claude backend needs a pre-authenticated `claude` CLI login on this machine. " +
          "Run `claude` once in a terminal and complete login, then retry. " +
          "(jarvis_bridge does not yet support logging in from within the app — see docs/claude-acp-future-phases.md.)",
      );
    } else {
      console.error(
        "[jarvis-bridge] hint: if the agent CLI requires login, run it once in a terminal to authenticate, then retry.",
      );
    }
    await registry.shutdown().catch(() => {});
    process.exit(1);
  }
```

This is a message-only change reading a `kind` string for a log line — not a behavioral branch in the shared ACP layer, so it doesn't violate the capability-driven constraint (that constraint governs `src/agent/acp/*` and `src/server.ts`, not one-off startup diagnostics).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add agents.json.example package.json src/index.ts
git commit -m "feat: add Claude backend profile, bump node engine to >=22, backend-aware auth hint"
```

---

### Task 11: Live probe + `docs/agent-claude-code.md`

**Files:**
- Create: `docs/agent-claude-code.md`
- Create (scratch, not committed): probe transcript, e.g. `/tmp/claude-acp-probe/probe.jsonl`

This task is exploratory/manual — its "test" is the probe actually running end-to-end against a real, pre-authenticated `claude` CLI, not an automated assertion. Do not write `docs/agent-claude-code.md` before this step produces real captured JSON — every wire-shape claim in the doc must cite the transcript, not be guessed from the earlier static source analysis.

- [ ] **Step 1: Confirm local Claude Code auth is ready**

```bash
claude --version
```

Expected: prints a version. If this fails, stop and run `claude` login interactively first (per Task 10's hint) — the probe cannot proceed without a pre-authenticated `~/.claude`.

- [ ] **Step 2: Spawn the adapter directly and capture one full session**

```bash
mkdir -p /tmp/claude-acp-probe
npx -y @agentclientprotocol/claude-agent-acp@latest 2> /tmp/claude-acp-probe/stderr.log | tee /tmp/claude-acp-probe/probe.jsonl
```

With the process running, in a separate terminal, drive it by hand over stdin (or write a tiny throwaway Node script using `src/agent/acp/jsonrpc.ts`'s `AcpConnection.spawn` directly against `npx -y @agentclientprotocol/claude-agent-acp@latest` — simpler and reusable): send, in order:
1. `initialize` with `clientCapabilities: { elicitation: { form: {} } }` — capture the full response.
2. `session/new` with `{ cwd: "/tmp/claude-acp-probe", mcpServers: [] }` — capture the full response (confirm `modes`/`configOptions` shape from Task 9 matches reality).
3. `session/prompt` with a trivial prompt (e.g. "reply with exactly the word OK and nothing else") — capture every `session/update` notification and the final response (confirm `usage`/`usage_update` field names from Task 8's analysis).
4. A prompt that triggers a tool call (e.g. "read the file /tmp/claude-acp-probe/probe.jsonl and tell me its byte length") — capture the `tool_call`/`tool_call_update` sequence and, if a permission prompt fires, the `session/request_permission` request shape (confirm `allow`/`reject` option ids from the earlier static analysis).
5. Re-run `initialize` twice: once advertising `clientCapabilities: { elicitation: { form: {} } }` and once omitting it entirely, each followed by a prompt that would trigger `AskUserQuestion` (e.g. "use the AskUserQuestion tool to ask me what color I like") — compare whether the tool call degrades to an ordinary `session/request_permission`-style flow when elicitation isn't advertised, per the open question in the design spec.

- [ ] **Step 3: Reconcile the probe against Tasks 7-9's implementation**

Diff the captured `usage_update`/final-result field names against `usageFromAcp`'s accepted key set (`src/agent/acp/mapping.ts:227-245`) — if the probe reveals a field name not already handled (camelCase or snake_case), that's a real gap: add it to `AcpUsageShape` and `usageFromAcp` in this step, with a regression test in `src/agent/acp/mapping.test.ts` using the exact captured field names as the test fixture input.

- [ ] **Step 4: Decide the elicitation-advertisement question and apply it**

Based on Step 2.5's result: if omitting `clientCapabilities.elicitation.form` makes `AskUserQuestion` degrade to the existing generic `session/request_permission` flow (already handled by `routeApprovalToUI`, no code change needed), update the `initialize` call in `src/agent/acp/index.ts:116-119` to drop the `elicitation` key from `clientCapabilities` entirely (capability-driven: this doesn't special-case Claude, it just changes what jarvis_bridge advertises globally, and opencode's binding doc doesn't rely on it either — grep `docs/archives/implementation/10-agent-opencode.md` for "elicitation" to confirm opencode never calls it, so this is a safe global change). If instead omitting it causes `AskUserQuestion` calls to error or hang, keep advertising it as today and record that real elicitation handling (deferred, `docs/claude-acp-future-phases.md`) is required before `AskUserQuestion` is usable with Claude.

- [ ] **Step 5: Write `docs/agent-claude-code.md`**

Mirror the structure of `docs/archives/implementation/10-agent-opencode.md` (sections: Invocation, Transport, Handshake, Auth, Session lifecycle, Streaming turn, Tool calls, Permissions, Usage, Slash commands, Probe transcript reference, Known gaps). Populate every wire-shape claim from the Step 2 transcript (cite `/tmp/claude-acp-probe/probe.jsonl` line numbers the way the opencode doc cites its own probe capture), not from the earlier static-source-analysis conversation. Explicitly note: the `unstable_forkSession`/`unstable_createElicitation` naming as a version-drift risk; the `allow`/`reject` permission option ids (correcting the misleading opencode-specific example in `docs/archives/implementation/02-acp-backend.md`); the CLI-delegated auth model; the resolved elicitation-advertisement decision from Step 4.

- [ ] **Step 6: Commit**

```bash
git add docs/agent-claude-code.md src/agent/acp/index.ts src/agent/acp/mapping.ts src/agent/acp/mapping.test.ts
git commit -m "docs: add Claude ACP binding profile from live probe; reconcile usage fields + elicitation advertisement"
```

(Only `git add` the source files above if Step 3/4 actually produced changes — if the probe confirms everything matches the static analysis exactly, this commit is docs-only.)

---

### Task 12: Frontend — Settings panel default-backend control

**Files:**
- Modify: `frontend/src/components/SettingsPanel.tsx`
- Modify: `frontend/src/api/types.ts`

**Interfaces:**
- Consumes: `GET /settings/default-backend`, `PUT /settings/default-backend` (Task 6); `fetchJSON` (`frontend/src/api/client.ts`, unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add response types**

In `frontend/src/api/types.ts`, add:

```typescript
export interface DefaultBackendState {
  ok: boolean;
  available: string[];
  default: string;
}
```

- [ ] **Step 2: Add the control to `SettingsPanel.tsx`**

```typescript
import { useEffect, useState } from "react";
import { fetchJSON } from "../api/client";
import type { DefaultBackendState } from "../api/types";

// ... existing KEY/load/save quick-phrases code unchanged ...

export function SettingsPanel() {
  const [phrases, setPhrases] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [backends, setBackends] = useState<DefaultBackendState | null>(null);
  const [backendSaving, setBackendSaving] = useState(false);

  useEffect(() => { setPhrases(load()); }, []);
  useEffect(() => {
    void fetchJSON<DefaultBackendState>("/settings/default-backend").then((res) => {
      if (res.ok && res.data) setBackends(res.data);
    });
  }, []);

  const onChangeDefaultBackend = async (name: string) => {
    setBackendSaving(true);
    try {
      const res = await fetchJSON<DefaultBackendState>("/settings/default-backend", {
        method: "PUT",
        body: { name },
      });
      if (res.ok && res.data) setBackends((prev) => (prev ? { ...prev, default: res.data.default } : prev));
    } finally {
      setBackendSaving(false);
    }
  };

  // ... existing add/remove unchanged ...

  return (
    <div style={{ padding: 16 }}>
      <h2>Settings</h2>
      <h3>Default agent backend</h3>
      {backends ? (
        <>
          <p style={{ color: "var(--color-text-muted)" }}>
            New chats use this backend. Restart-free — takes effect on the next new session.
          </p>
          <select
            value={backends.default}
            disabled={backendSaving}
            onChange={(e) => void onChangeDefaultBackend(e.target.value)}
          >
            {backends.available.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </>
      ) : (
        <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
      )}
      <h3>Quick phrases</h3>
      {/* ... existing quick-phrases markup unchanged ... */}
    </div>
  );
}
```

- [ ] **Step 3: Manual check**

Run: `npm run dev:web` (with the gateway also running per Task 4's startup) and open the Settings panel in the browser; confirm the dropdown lists both configured backend names and that switching persists across a page reload (re-fetch confirms `GET /settings/default-backend` reflects the change).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SettingsPanel.tsx frontend/src/api/types.ts
git commit -m "feat: add default-backend picker to the Settings panel"
```

---

### Task 13: Frontend — delete-session action

**Files:**
- Modify: `frontend/src/components/PastChatsMenu.tsx`
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/components/PastChatsMenu.test.tsx`

**Interfaces:**
- Consumes: `DELETE /chat/sessions/:id` (Task 6); `capabilities.sessionDelete` (already flows through `ChatContext`'s existing `capabilities` state, unchanged plumbing from Task 2/5).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend `PastChatsMenuProps`**

```typescript
export interface PastChatsMenuProps {
  open: boolean;
  sessions: SessionSummary[];
  onClose: () => void;
  onSwitch: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  canDelete?: boolean;
}
```

- [ ] **Step 2: Render a delete button per row, gated on `canDelete`**

```typescript
export function PastChatsMenu({ open, sessions, onClose, onSwitch, onDelete, canDelete }: PastChatsMenuProps) {
  if (!open) return null;
  return (
    <div /* ...unchanged wrapper... */>
      <div /* ...unchanged inner box... */>
        <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>Chats</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {sessions.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)" }}>(no past chats yet)</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.sessionId} style={{ padding: "4px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => onSwitch(s.sessionId)}>
                  {s.customTitle || s.title || s.sessionId.slice(0, 12)}
                  {s.pinned ? " 📌" : ""}
                </span>
                {canDelete && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete?.(s.sessionId); }}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it up in `ChatPanel.tsx`**

Add near `onSwitchSession` (currently lines 181-187):

```typescript
  const onDeleteSession = useCallback(
    async (sessionId: string) => {
      const res = await fetchJSON(`/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (res.ok) {
        const refreshed = await fetchJSON<{ sessions: SessionSummary[] }>("/chat/sessions");
        if (refreshed.ok && refreshed.data) setSessions(refreshed.data.sessions);
        toast.push("Session deleted", "success");
      } else {
        toast.push("Could not delete session", "error");
      }
    },
    [toast],
  );
```

Update the `<PastChatsMenu ... />` usage (currently line 218):

```typescript
          <PastChatsMenu
            open={pastChatsOpen}
            sessions={sessions}
            onClose={() => setPastChatsOpen(false)}
            onSwitch={onSwitchSession}
            onDelete={onDeleteSession}
            canDelete={!!ctx.state.capabilities?.sessionDelete}
          />
```

- [ ] **Step 4: Update the existing component test**

In `frontend/src/components/PastChatsMenu.test.tsx`, add a case:

```typescript
test("renders a Delete button per session when canDelete is true", () => {
  const onDelete = vi.fn();
  render(
    <PastChatsMenu
      open={true}
      sessions={[{ sessionId: "s1", title: "Test" }]}
      onClose={vi.fn()}
      onSwitch={vi.fn()}
      onDelete={onDelete}
      canDelete={true}
    />,
  );
  const btn = screen.getByRole("button", { name: "Delete" });
  fireEvent.click(btn);
  expect(onDelete).toHaveBeenCalledWith("s1");
});

test("omits the Delete button when canDelete is false", () => {
  render(
    <PastChatsMenu
      open={true}
      sessions={[{ sessionId: "s1", title: "Test" }]}
      onClose={vi.fn()}
      onSwitch={vi.fn()}
      canDelete={false}
    />,
  );
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
});
```

(Add `screen`/`fireEvent` to the existing `@testing-library/react` import at the top of the file if not already imported.)

- [ ] **Step 5: Run the frontend test suite**

Run: `npm run test:web`
Expected: PASS, including the two new cases.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PastChatsMenu.tsx frontend/src/components/PastChatsMenu.test.tsx frontend/src/components/ChatPanel.tsx
git commit -m "feat: add capability-gated delete-session action to PastChatsMenu"
```

---

### Task 14: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Build and start with both backends configured**

```bash
cp agents.json.example agents.json
# Edit agents.json if your claude-agent-acp is installed globally rather than via npx.
npm run build
npm start
```

Expected: startup log shows `backends: opencode, claude (default: opencode)` (or whatever `JARVIS_BRIDGE_DEFAULT_BACKEND`/`.env` specifies), healthcheck passes against the default backend only.

- [ ] **Step 2: Switch default backend to Claude via Settings, start a new chat**

In the browser: open Settings, switch the default-backend dropdown to `claude`, start a new chat. Confirm: a real chat turn streams text, a tool call (e.g. ask it to read a file) renders and completes, an approval prompt appears if auto-approve is off and resolves correctly on Approve/Deny.

- [ ] **Step 3: Delete a Claude session**

Open the Chats menu, confirm a "Delete" button appears (Claude advertises `sessionDelete`), delete the session, confirm it disappears from the list and `GET /chat/sessions` no longer returns it.

- [ ] **Step 4: Switch back to opencode, confirm no regression**

Switch the default-backend dropdown back to `opencode`, start a new chat, confirm the existing opencode flow (chat, tool calls, fork, steer if supported) still works exactly as before this plan, and confirm the Chats menu does **not** show a Delete button for opencode sessions (since opencode's `AcpAgentBackend.deleteSession` stays absent — it never advertises `sessionCapabilities.delete`).

- [ ] **Step 5: Confirm queued prompts work for Claude**

In a Claude-backed chat, send a message, and — before it finishes — send a second message. Confirm both are answered in order (no "session is busy" error), corroborating Task 8's queueing logic against the real adapter, not just the fake fixture.

- [ ] **Step 6: Record results**

If everything in Steps 2-5 passes: Phase 1 is done. Note any deviation from expected behavior as a new entry in `docs/claude-acp-future-phases.md`'s "Open questions to revisit" section (per the design spec's own instruction to route future-phases updates there) rather than silently reopening earlier tasks.

---

## Self-Review Notes

**Spec coverage:** Every section of `docs/superpowers/specs/2026-07-12-claude-acp-backend-design.md` maps to a task — config/registry (Tasks 1, 3, 4), capability additions (Task 2), server threading + new routes (Tasks 5, 6), busy-gate/queueing (Task 8), session-delete (Tasks 2, 7), generalized config parsing (Task 9), Claude spawn/auth (Task 10), live probe + binding doc (Task 11), Settings UI (Task 12), delete UI (Task 13), manual verification (Task 14).

**Placeholder scan:** No TBD/TODO markers. Task 11 is intentionally exploratory (a live probe can't have its output pre-written), but every step in it has concrete commands and concrete decision criteria, not vague instructions.

**Type consistency:** `BackendProfile`, `SettingsStore`, `BackendRegistry`/`RegistrySessionEntry`, and the `AgentCapabilities`/`AgentBackend` additions are defined once (Tasks 1-3) and referenced identically (same names, same shapes) in every later task that consumes them (Tasks 4-13) — cross-checked field-by-field while writing this plan.
