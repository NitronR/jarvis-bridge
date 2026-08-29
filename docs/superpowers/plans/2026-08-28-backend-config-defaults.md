# Per-Backend Config Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set a default Mode / Effort / Agent per backend in the Settings dialog; sessions inherit it unless they have their own per-session override.

**Architecture:** Two new keys in `settings.json` — a `configCatalog` of what each backend reports (cached from live sessions) and the `configDefaults` the user picked. Both are proxied on `BackendRegistry` rather than added as a `createServer` option, so the wiring can't be silently omitted. `/chat/init` populates the catalog and applies defaults for any option the session hasn't overridden.

**Tech Stack:** TypeScript (strict), Express + zod, `node:test` + `assert`, React + Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-28-backend-config-defaults-design.md`

## Global Constraints

- Resolution chain is **session override → backend default → agent's starting value**, resolved at use time. Never stamp a default into `session_metadata.json`.
- `model` is excluded from defaults, as it is from the session pickers.
- `settings.json` must be written by merging all in-memory keys, never by overwriting with a single-key object.
- No new `CreateServerOptions` field — everything reaches `server.ts` through `registry`.
- Match surrounding style: `SettingsDialog.tsx` uses native `<select>`, not the custom `Select` component.
- Gates: `npm test` + `npm run typecheck` at root; `npm run test:web` at root. `cd frontend && npx tsc --noEmit` has **four pre-existing failing files** (`InfoPanel.test.tsx`, `Transcript.tsx`, `Transcript.test.tsx`, `useChat.ts`) — the bar is "no new files in that list", not "clean".
- **Do not `git commit` without asking the user first.**

## Two refinements to the spec, from reading the code

1. **Three session paths, one common block.** `/chat/init` produces a session three ways: `loadSession` (`src/server.ts:105-145`), resident-session reuse (`:96-104`), and `createSession` (`:155-181`). `backendName`, `backend`, and `session` are all resolved after the if/else closes at `:181`, so the catalog populate and defaults apply go in **one block there**, covering all three — not duplicated per branch as the spec sketched.
2. **Skip sessions with an in-flight turn.** The resident-session branch exists precisely because a turn is still streaming; `docs/acp-notes.md` warns that touching such a session orphans its patch pump. The apply loop must no-op when `session.getActiveTurn?.()` is truthy.

---

### Task 1: Stop `settings.json` from clobbering itself

**Files:**
- Modify: `src/agent/settingsStore.ts:36-47`
- Test: `src/agent/settingsStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no signature change. `setDefaultBackendName` preserves unknown keys already in the file.

- [ ] **Step 1: Write the failing test**

Append to `src/agent/settingsStore.test.ts` (the file's helper is `tmpPath()`):

```typescript
test("setDefaultBackendName preserves other keys already in the file", async () => {
  const p = await tmpPath();
  await fs.writeFile(p, JSON.stringify({ defaultBackendName: "opencode", configDefaults: { claude: { effort: "high" } } }), "utf8");
  const store = await createSettingsStore({ path: p, envDefault: "opencode", validNames: ["opencode", "claude"] });
  await store.setDefaultBackendName("claude");
  const onDisk = JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
  assert.equal(onDisk.defaultBackendName, "claude");
  assert.deepEqual(onDisk.configDefaults, { claude: { effort: "high" } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern "preserves other keys" src/agent/settingsStore.test.ts`
Expected: FAIL — `onDisk.configDefaults` is `undefined`; the write replaced the whole file.

- [ ] **Step 3: Introduce a persist() that writes every key**

In `src/agent/settingsStore.ts`, widen the file shape and add a `persist()`, mirroring `sessionConfigStore.ts`:

```typescript
interface SettingsFileShape {
  defaultBackendName?: string;
  configCatalog?: Record<string, unknown>;
  configDefaults?: Record<string, Record<string, string>>;
}
```

Inside `createSettingsStore`, after the existing `persisted` load, keep the unrecognized-but-known keys in memory:

```typescript
  let configCatalog: Record<string, unknown> = persisted.configCatalog ?? {};
  let configDefaults: Record<string, Record<string, string>> = persisted.configDefaults ?? {};

  async function persist(): Promise<void> {
    const data: SettingsFileShape = {
      defaultBackendName: current,
      configCatalog,
      configDefaults,
    };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }
```

Replace the body of `setDefaultBackendName`'s write:

```typescript
    async setDefaultBackendName(name: string): Promise<void> {
      if (!validNames.includes(name)) {
        throw new Error(`unknown backend name: ${name}`);
      }
      current = name;
      await persist();
    },
```

Task 2 replaces the `unknown` in `configCatalog` with a real type; leaving it loose here keeps this task to the one behavior change.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. Note `npm test` has one **pre-existing flaky** failure, `idle-turn reaper cancels a turn nobody has attached to after the grace period` — it fails intermittently on a clean tree too. Any *other* failure is real.

- [ ] **Step 5: Commit** (ask the user first)

```bash
git add src/agent/settingsStore.ts src/agent/settingsStore.test.ts
git commit -m "fix: merge settings.json on write instead of overwriting it"
```

---

### Task 2: Catalog + defaults on `SettingsStore`

**Files:**
- Modify: `src/agent/settingsStore.ts`
- Test: `src/agent/settingsStore.test.ts`

**Interfaces:**
- Consumes: `persist()` from Task 1.
- Produces:
  ```typescript
  export interface CatalogOption {
    id: string;
    name: string;
    category?: string;
    options: Array<{ value: string; name: string }>;
  }

  getConfigCatalog(backendName: string): CatalogOption[];
  setConfigCatalog(backendName: string, options: CatalogOption[]): Promise<void>;
  getConfigDefaults(backendName: string): Record<string, string>;
  setConfigDefault(backendName: string, configId: string, value: string | null): Promise<void>;
  ```
  `setConfigCatalog` writes nothing when the serialized catalog is unchanged. `setConfigDefault(…, null)` deletes the entry, and deletes the backend's map when it empties.

- [ ] **Step 1: Write the failing tests**

Append to `src/agent/settingsStore.test.ts`:

```typescript
const CATALOG = [
  { id: "effort", name: "Effort", category: "thought_level", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
];

test("catalog and defaults round-trip through disk", async () => {
  const p = await tmpPath();
  const store = await createSettingsStore({ path: p, envDefault: "claude", validNames: ["opencode", "claude"] });
  assert.deepEqual(store.getConfigCatalog("claude"), []);
  assert.deepEqual(store.getConfigDefaults("claude"), {});
  await store.setConfigCatalog("claude", CATALOG);
  await store.setConfigDefault("claude", "effort", "high");

  const reloaded = await createSettingsStore({ path: p, envDefault: "claude", validNames: ["opencode", "claude"] });
  assert.deepEqual(reloaded.getConfigCatalog("claude"), CATALOG);
  assert.deepEqual(reloaded.getConfigDefaults("claude"), { effort: "high" });
  assert.deepEqual(reloaded.getConfigCatalog("opencode"), []);
});

test("setConfigDefault with null clears the entry", async () => {
  const p = await tmpPath();
  const store = await createSettingsStore({ path: p, envDefault: "claude", validNames: ["opencode", "claude"] });
  await store.setConfigDefault("claude", "effort", "high");
  await store.setConfigDefault("claude", "effort", null);
  assert.deepEqual(store.getConfigDefaults("claude"), {});
});

test("setConfigCatalog does not rewrite the file when the catalog is unchanged", async () => {
  const p = await tmpPath();
  const store = await createSettingsStore({ path: p, envDefault: "claude", validNames: ["opencode", "claude"] });
  await store.setConfigCatalog("claude", CATALOG);
  const firstWrite = (await fs.stat(p)).mtimeMs;
  await new Promise((r) => setTimeout(r, 12));
  await store.setConfigCatalog("claude", CATALOG);
  assert.equal((await fs.stat(p)).mtimeMs, firstWrite);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern "catalog|setConfigDefault" src/agent/settingsStore.test.ts`
Expected: FAIL — `store.getConfigCatalog is not a function`.

- [ ] **Step 3: Add the type and the interface entries**

In `src/agent/settingsStore.ts`, above `SettingsStore`:

```typescript
// What options a backend reports, cached so the Settings dialog can offer
// defaults for a backend that has no live session right now. Deliberately
// without `currentValue` — that is one session's live value, not a default.
export interface CatalogOption {
  id: string;
  name: string;
  category?: string;
  options: Array<{ value: string; name: string }>;
}
```

Add to `SettingsStore`:

```typescript
  getConfigCatalog(backendName: string): CatalogOption[];
  setConfigCatalog(backendName: string, options: CatalogOption[]): Promise<void>;
  getConfigDefaults(backendName: string): Record<string, string>;
  setConfigDefault(backendName: string, configId: string, value: string | null): Promise<void>;
```

Tighten the file shape and the in-memory holder from Task 1:

```typescript
  configCatalog?: Record<string, CatalogOption[]>;
```
```typescript
  let configCatalog: Record<string, CatalogOption[]> = persisted.configCatalog ?? {};
```

- [ ] **Step 4: Implement the four methods**

Add to the returned object:

```typescript
    getConfigCatalog(backendName: string): CatalogOption[] {
      return configCatalog[backendName] ?? [];
    },
    async setConfigCatalog(backendName: string, options: CatalogOption[]): Promise<void> {
      // Called on every /chat/init — only touch disk when it actually changed.
      if (JSON.stringify(configCatalog[backendName] ?? []) === JSON.stringify(options)) return;
      configCatalog = { ...configCatalog, [backendName]: options };
      await persist();
    },
    getConfigDefaults(backendName: string): Record<string, string> {
      return { ...(configDefaults[backendName] ?? {}) };
    },
    async setConfigDefault(backendName: string, configId: string, value: string | null): Promise<void> {
      const cur = { ...(configDefaults[backendName] ?? {}) };
      if (value == null) delete cur[configId];
      else cur[configId] = value;
      const next = { ...configDefaults };
      if (Object.keys(cur).length === 0) delete next[backendName];
      else next[backendName] = cur;
      configDefaults = next;
      await persist();
    },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (modulo the known flake).

- [ ] **Step 6: Commit** (ask the user first)

```bash
git add src/agent/settingsStore.ts src/agent/settingsStore.test.ts
git commit -m "feat: persist per-backend config catalog and defaults"
```

---

### Task 3: Proxy the four methods on `BackendRegistry`

**Files:**
- Modify: `src/agent/backendRegistry.ts:23-35` (interface), `:90-105` (implementation)
- Test: `src/agent/backendRegistry.test.ts`

**Interfaces:**
- Consumes: Task 2's `SettingsStore` methods and `CatalogOption`.
- Produces: the same four names on `BackendRegistry`. `setConfigCatalog` / `setConfigDefault` throw `unknown backend name: <name>` for a name not in the profile list, matching `setDefaultBackendName`'s guard.

- [ ] **Step 1: Write the failing test**

Append to `src/agent/backendRegistry.test.ts`, following its `profiles()` / `mkWorkspace()` conventions:

```typescript
test("config catalog and defaults round-trip through the registry", async () => {
  const workspace = await mkWorkspace();
  let registry;
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const catalog = [{ id: "effort", name: "Effort", options: [{ value: "high", name: "High" }] }];
    await registry.setConfigCatalog("claude", catalog);
    await registry.setConfigDefault("claude", "effort", "high");
    assert.deepEqual(registry.getConfigCatalog("claude"), catalog);
    assert.deepEqual(registry.getConfigDefaults("claude"), { effort: "high" });
    assert.deepEqual(registry.getConfigDefaults("opencode"), {});
    await assert.rejects(() => registry!.setConfigDefault("nonesuch", "effort", "high"), /unknown backend name/);
  } finally {
    await registry?.shutdown();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern "round-trip through the registry" src/agent/backendRegistry.test.ts`
Expected: FAIL — `registry.setConfigCatalog is not a function`.

- [ ] **Step 3: Add to the interface**

In `src/agent/backendRegistry.ts`, import the type and add after `listBackendNames()`:

```typescript
  getConfigCatalog(backendName: string): CatalogOption[];
  setConfigCatalog(backendName: string, options: CatalogOption[]): Promise<void>;
  getConfigDefaults(backendName: string): Record<string, string>;
  setConfigDefault(backendName: string, configId: string, value: string | null): Promise<void>;
```

Extend the existing `import type { SettingsStore } from "./settingsStore";` to `import type { CatalogOption, SettingsStore } from "./settingsStore";`.

- [ ] **Step 4: Implement the proxies**

In the `registry` object, after `listBackendNames`:

```typescript
    getConfigCatalog(backendName: string): CatalogOption[] {
      return settings.getConfigCatalog(backendName);
    },
    async setConfigCatalog(backendName: string, options: CatalogOption[]): Promise<void> {
      if (!byName.has(backendName)) throw new Error(`unknown backend name: ${backendName}`);
      await settings.setConfigCatalog(backendName, options);
    },
    getConfigDefaults(backendName: string): Record<string, string> {
      return settings.getConfigDefaults(backendName);
    },
    async setConfigDefault(backendName: string, configId: string, value: string | null): Promise<void> {
      if (!byName.has(backendName)) throw new Error(`unknown backend name: ${backendName}`);
      await settings.setConfigDefault(backendName, configId, value);
    },
```

- [ ] **Step 5: Update the test registry stub**

`src/server.test.ts`'s `makeSingleBackendTestRegistry` builds a `BackendRegistry`-shaped object literal, so four new required members break its typecheck. Add an in-memory implementation there:

```typescript
  const catalogs = new Map<string, import("./agent/settingsStore").CatalogOption[]>();
  const defaults = new Map<string, Record<string, string>>();
```
```typescript
    getConfigCatalog: (name: string) => catalogs.get(name) ?? [],
    setConfigCatalog: async (name: string, options) => { catalogs.set(name, options); },
    getConfigDefaults: (name: string) => ({ ...(defaults.get(name) ?? {}) }),
    setConfigDefault: async (name: string, configId: string, value: string | null) => {
      const cur = { ...(defaults.get(name) ?? {}) };
      if (value == null) delete cur[configId];
      else cur[configId] = value;
      defaults.set(name, cur);
    },
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (modulo the known flake).

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add src/agent/backendRegistry.ts src/agent/backendRegistry.test.ts src/server.test.ts
git commit -m "feat: proxy config catalog and defaults on the backend registry"
```

---

### Task 4: Routes, catalog population, and default application

These ship together because neither half is testable alone: applying a default needs the
`PUT` route to set one, and the route's catalog validation needs the `/chat/init` block
that fills the catalog. Splitting them would mean a task that can only be verified by the
next task's code.

**Files:**
- Modify: `src/server.ts:181` (one common block, after the if/else closes), `:645-662` (routes, next to `/settings/default-backend`), `:804` (zod schema)
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes: Task 3's registry methods; `getSessionConfigOptions` and `setSessionConfigOption` (shipped); `sessionConfig.getConfigOverrides` (shipped).
- Produces:
  - Behavior: every `/chat/init` refreshes that backend's catalog and applies unoverridden defaults, unless the session has an active turn.
  - `GET /settings/config-defaults` → `{ ok: true, backends: Array<{ name: string; options: CatalogOption[]; defaults: Record<string, string> }> }`, one entry per `registry.listBackendNames()`.
  - `PUT /settings/config-default` `{ backend, configId, value: string | null }` → `{ ok: true, defaults: Record<string, string> }`. 400 on unknown backend, on `configId: "model"`, and on a `configId`/`value` absent from that backend's catalog. A `null` value skips catalog validation so a stale default can always be cleared.

- [ ] **Step 1: Write the failing tests**

Append to `src/server.test.ts`. `FAKE_CONFIG_OPTIONS` already exists in this file from the pickers change.

```typescript
test("/chat/init caches the backend's config catalog", async () => {
  await withServer(async () => {
    const backend = new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS });
    return {
      backend,
      fn: async (url) => {
        await fetch(`${url}/chat/init`);
        const res = await fetch(`${url}/settings/config-defaults`);
        const body = (await res.json()) as { backends: Array<{ name: string; options: Array<{ id: string }> }> };
        const entry = body.backends.find((b) => b.name === "fake");
        assert.deepEqual(entry?.options.map((o) => o.id), ["effort"]);
      },
    };
  });
});

test("a backend default is applied to a new session", async () => {
  await withServer(async () => {
    const backend = new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS });
    return {
      backend,
      fn: async (url) => {
        // One init to populate the catalog, so the PUT can validate against it.
        await fetch(`${url}/chat/init`);
        await fetch(`${url}/settings/config-default`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backend: "fake", configId: "effort", value: "high" }),
        });
        const res = await fetch(`${url}/chat/init`);
        const body = (await res.json()) as { configOptions: Array<{ id: string; currentValue: string }> };
        assert.equal(body.configOptions.find((o) => o.id === "effort")?.currentValue, "high");
      },
    };
  });
});

test("a session override beats the backend default", async () => {
  await withServer(async () => {
    const backend = new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS });
    return {
      backend,
      fn: async (url) => {
        const { sessionId } = (await (await fetch(`${url}/chat/init`)).json()) as { sessionId: string };
        await fetch(`${url}/chat/config-option`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, configId: "effort", value: "low" }),
        });
        await fetch(`${url}/settings/config-default`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backend: "fake", configId: "effort", value: "high" }),
        });
        const res = await fetch(`${url}/chat/init?sessionId=${sessionId}`);
        const body = (await res.json()) as { configOptions: Array<{ id: string; currentValue: string }> };
        assert.equal(body.configOptions.find((o) => o.id === "effort")?.currentValue, "low");
      },
    };
  });
});
```

Plus the route-validation test:

```typescript
test("PUT /settings/config-default validates against the cached catalog", async () => {
  await withServer(async () => ({
    backend: new FakeBackend({ configOptions: FAKE_CONFIG_OPTIONS }),
    fn: async (url) => {
      await fetch(`${url}/chat/init`);
      const put = (payload: Record<string, unknown>) =>
        fetch(`${url}/settings/config-default`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      assert.equal((await put({ backend: "fake", configId: "effort", value: "high" })).status, 200);
      assert.equal((await put({ backend: "nonesuch", configId: "effort", value: "high" })).status, 400);
      assert.equal((await put({ backend: "fake", configId: "model", value: "m1" })).status, 400);
      assert.equal((await put({ backend: "fake", configId: "nope", value: "high" })).status, 400);
      assert.equal((await put({ backend: "fake", configId: "effort", value: "nope" })).status, 400);
      // Clearing always works, even for an id no longer in the catalog.
      const cleared = await put({ backend: "fake", configId: "effort", value: null });
      assert.equal(cleared.status, 200);
      const body = (await cleared.json()) as { defaults: Record<string, string> };
      assert.deepEqual(body.defaults, {});
    },
  }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test --test-name-pattern "config catalog|backend default|session override beats|cached catalog" src/server.test.ts`
Expected: FAIL, 4 tests — `/settings/config-defaults` and `/settings/config-default` both 404.

- [ ] **Step 3: Add the common block**

In `src/server.ts`, immediately after the if/else closes at `:181` and before the auto-approve reseed comment at `:182`:

```typescript
    // Cache what this backend reports so the Settings dialog can offer defaults
    // for it later, even with no live session. Then apply those defaults to any
    // option this session hasn't explicitly overridden — the session's own
    // choice always wins, and nothing is stamped into session_metadata.json.
    const sessionConfigOptions = backend.getSessionConfigOptions?.(session.id) ?? null;
    if (sessionConfigOptions) {
      await registry.setConfigCatalog(
        backendName,
        sessionConfigOptions.map(({ id, name, category, options }) => ({ id, name, category, options })),
      );
    }
    // A streaming turn owns this session's context — touching its config here
    // is the same hazard loadSession has (see docs/acp-notes.md).
    if (!session.getActiveTurn?.()) {
      const configDefaults = registry.getConfigDefaults(backendName);
      const sessionOverrides = opts.sessionConfig?.getConfigOverrides(session.id) ?? {};
      for (const [configId, value] of Object.entries(configDefaults)) {
        if (sessionOverrides[configId] !== undefined) continue;
        try {
          await backend.setSessionConfigOption?.(session.id, configId, value);
        } catch (e) {
          console.log(`[INIT]   default ${configId}=${value} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
```

- [ ] **Step 4: Add the schema and both routes**

Next to `ModelQuerySchema` in `src/server.ts`:

```typescript
const SetConfigDefaultBodySchema = z.object({
  backend: z.string(),
  configId: z.string(),
  value: z.union([z.string(), z.null()]),
});
```

After the `PUT /settings/default-backend` handler:

```typescript
  app.get("/settings/config-defaults", smallJson, (_req, res) => {
    res.json({
      ok: true,
      backends: registry.listBackendNames().map((name) => ({
        name,
        options: registry.getConfigCatalog(name),
        defaults: registry.getConfigDefaults(name),
      })),
    });
  });

  app.put("/settings/config-default", smallJson, asyncRoute(async (req, res) => {
    const body = SetConfigDefaultBodySchema.parse(req.body ?? {});
    if (body.configId === "model") {
      res.status(400).json({ error: "model has no per-backend default" });
      return;
    }
    if (!registry.listBackendNames().includes(body.backend)) {
      res.status(400).json({ error: `unknown backend name: ${body.backend}` });
      return;
    }
    // Clearing is always allowed — a default for an option the agent stopped
    // reporting must still be removable.
    if (body.value !== null) {
      const option = registry.getConfigCatalog(body.backend).find((o) => o.id === body.configId);
      if (!option) {
        res.status(400).json({ error: `unknown configId for ${body.backend}: ${body.configId}` });
        return;
      }
      if (!option.options.some((o) => o.value === body.value)) {
        res.status(400).json({ error: `unknown value for ${body.configId}: ${body.value}` });
        return;
      }
    }
    await registry.setConfigDefault(body.backend, body.configId, body.value);
    res.json({ ok: true, defaults: registry.getConfigDefaults(body.backend) });
  }));
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, all four new tests green. Only the known `idle-turn reaper` flake may fail.

- [ ] **Step 6: Commit** (ask the user first)

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: per-backend config defaults, applied on session init"
```

---

### Task 5: Settings dialog section

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/components/SettingsDialog.tsx:66-84`
- Create: `frontend/src/components/SettingsDialog.test.tsx`

**Interfaces:**
- Consumes: Task 4's two routes.
- Produces:
  ```typescript
  export interface CatalogOption {
    id: string;
    name: string;
    category?: string;
    options: Array<{ value: string; name: string }>;
  }
  export interface ConfigDefaultsState {
    backends: Array<{ name: string; options: CatalogOption[]; defaults: Record<string, string> }>;
  }
  ```
  The dialog's select for an option with no default selects `""`, whose label is "Agent default"; picking it PUTs `value: null`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/SettingsDialog.test.tsx`. The dialog fetches `/settings/default-backend` and `/settings/config-defaults` on open, so the mock dispatches on URL:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import * as client from "../api/client";

const CONFIG_DEFAULTS = {
  backends: [
    {
      name: "claude",
      options: [
        { id: "effort", name: "Effort", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
      ],
      defaults: { effort: "high" },
    },
    { name: "opencode", options: [], defaults: {} },
  ],
};

describe("<SettingsDialog>", () => {
  let fetchJSONSpy: MockInstance<typeof client.fetchJSON>;
  beforeEach(() => {
    window.localStorage.clear();
    fetchJSONSpy = vi.spyOn(client, "fetchJSON").mockImplementation(async (url: string) => {
      if (url === "/settings/default-backend") {
        return { ok: true, status: 200, data: { available: ["claude", "opencode"], default: "claude" } };
      }
      if (url === "/settings/config-defaults") {
        return { ok: true, status: 200, data: CONFIG_DEFAULTS };
      }
      return { ok: true, status: 200, data: { ok: true, defaults: {} } };
    });
  });
  afterEach(() => { fetchJSONSpy.mockRestore(); window.localStorage.clear(); });

  it("renders a select per catalogued option, set to the current default", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const select = await screen.findByLabelText("claude — Effort");
    expect((select as HTMLSelectElement).value).toBe("high");
  });

  it("prompts to start a chat for a backend with no catalog", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    expect(await screen.findByText(/start a chat on this backend/i)).toBeInTheDocument();
  });

  it("PUTs the picked value", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const select = await screen.findByLabelText("claude — Effort");
    fireEvent.change(select, { target: { value: "low" } });
    await waitFor(() => {
      expect(fetchJSONSpy).toHaveBeenCalledWith("/settings/config-default", {
        method: "PUT",
        body: { backend: "claude", configId: "effort", value: "low" },
      });
    });
  });

  it("PUTs null when the agent default is picked", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const select = await screen.findByLabelText("claude — Effort");
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => {
      expect(fetchJSONSpy).toHaveBeenCalledWith("/settings/config-default", {
        method: "PUT",
        body: { backend: "claude", configId: "effort", value: null },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/SettingsDialog.test.tsx`
Expected: FAIL — no element labelled "claude — Effort".

- [ ] **Step 3: Add the frontend types**

In `frontend/src/api/types.ts`, next to `ConfigOption`:

```typescript
export interface CatalogOption {
  id: string;
  name: string;
  category?: string;
  options: Array<{ value: string; name: string }>;
}
export interface ConfigDefaultsState {
  backends: Array<{ name: string; options: CatalogOption[]; defaults: Record<string, string> }>;
}
```

- [ ] **Step 4: Fetch and render the section**

In `SettingsDialog.tsx`, add state and load it in the existing `open` effect:

```typescript
  const [configDefaults, setConfigDefaults] = useState<ConfigDefaultsState | null>(null);
```
```typescript
    void fetchJSON<ConfigDefaultsState>("/settings/config-defaults").then((res) => {
      if (res.ok && res.data) setConfigDefaults(res.data);
    });
```

Add the handler next to `onChangeDefaultBackend`:

```typescript
  const onChangeConfigDefault = async (backend: string, configId: string, raw: string) => {
    const value = raw === "" ? null : raw;
    const res = await fetchJSON<{ ok: boolean; defaults: Record<string, string> }>(
      "/settings/config-default",
      { method: "PUT", body: { backend, configId, value } },
    );
    if (!res.ok || !res.data) return;
    setConfigDefaults((prev) =>
      prev
        ? {
            backends: prev.backends.map((b) =>
              b.name === backend ? { ...b, defaults: res.data!.defaults } : b,
            ),
          }
        : prev,
    );
  };
```

Render it after the default-backend block, before `<h3>Quick phrases</h3>`:

```tsx
          <h3>Backend defaults</h3>
          <p className={styles.muted}>
            Applied to sessions on that backend unless the chat has its own setting.
          </p>
          {configDefaults?.backends.map((b) => (
            <div key={b.name}>
              <h4>{b.name}</h4>
              {b.options.length === 0 ? (
                <p className={styles.muted}>Start a chat on this backend to configure its defaults.</p>
              ) : (
                b.options.map((opt) => (
                  <label key={opt.id}>
                    {`${b.name} — ${opt.name}`}
                    <select
                      value={b.defaults[opt.id] ?? ""}
                      onChange={(e) => void onChangeConfigDefault(b.name, opt.id, e.target.value)}
                    >
                      <option value="">Agent default</option>
                      {opt.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.name}</option>
                      ))}
                    </select>
                  </label>
                ))
              )}
            </div>
          ))}
```

The `<label>` wrapping the `<select>` is what makes `getByLabelText("claude — Effort")` resolve.

- [ ] **Step 5: Run the frontend gates**

Run: `npm run test:web`
Then: `cd frontend && npx tsc --noEmit 2>&1 | grep -E "^src/" | cut -d'(' -f1 | sort -u`
Expected: all tests pass; the type-error file list must contain **no new entries** beyond the four pre-existing ones (`InfoPanel.test.tsx`, `Transcript.tsx`, `Transcript.test.tsx`, `useChat.ts`).

- [ ] **Step 6: Manual verification**

`npm run dev` + `npm run dev:web`, open Settings: set Effort to `high` for the Claude backend, close, start a new chat, confirm the composer's Effort picker reads `high`. Then change that chat's Effort to `low`, reload the page, and confirm it stays `low` — the session override beating the backend default.

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add frontend/src/api/types.ts frontend/src/components/SettingsDialog.tsx frontend/src/components/SettingsDialog.test.tsx
git commit -m "feat(frontend): per-backend config defaults in the settings dialog"
```

---

## Post-implementation

Add a line to `AGENTS.md`'s "Backend configuration" section: `settings.json` now holds
`configCatalog` and `configDefaults` alongside `defaultBackendName`, and is merged on
write rather than overwritten.
