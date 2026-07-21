# Setup Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse Jarvis Bridge's first-time setup from six manual, partly-undocumented steps down to `npm install && npm run dev` for a clone, and a single `npx github:<owner>/jarvis_bridge` for a zero-clone trial.

**Architecture:** (1) Move all gateway state (`agents.json`, `settings.json`, `session_metadata.json`) out of the agent-sandboxed workspace into a new, non-agent-readable `~/.jarvis-bridge-system/` directory, with one-time migration of any existing files. (2) Merge `frontend/` into an npm workspace so one `npm install` covers both packages. (3) Add an idempotent `scripts/setup.js` that migrates old state, auto-detects installed backend CLIs to scaffold `agents.json`, and copies `.env.example` → `.env` — wired into both `postinstall` and `npm run setup`. (4) Add a `bin` entry whose launcher lazily builds `dist/`/`public/` (only when missing) and reuses the same setup logic, so `npx github:...` installs work standalone without slowing down ordinary local `npm install`.

**Tech Stack:** Node.js (TypeScript, CommonJS output) backend; plain Node CommonJS for `scripts/setup.js` (no new dependencies, must run before `npm install` finishes); `node:test` for backend tests.

## Global Constraints

- No new npm dependencies — `scripts/setup.js` and `bin/jarvis-bridge.js` use only Node core modules (`fs`, `path`, `os`).
- `scripts/setup.js` must be **idempotent**: re-running it never overwrites a file that already exists, and migration only moves a file when the new-location file doesn't already exist.
- `scripts/setup.js` must be **non-interactive**: no prompts, no `readline` — this is the design (auto-detect + defaults), and it also has to run safely inside `npm ci` / CI / Docker builds via `postinstall`.
- `JARVIS_BRIDGE_WORKSPACE` default stays `~/.jarvis-bridge` — no migration needed for anything the agent itself has written there.
- New `JARVIS_BRIDGE_SYSTEM_DIR` env var, default `~/.jarvis-bridge-system` — must resolve outside `JARVIS_BRIDGE_WORKSPACE`'s tree so it is never reachable through `pathGuard`'s `assertInWorkspace` (i.e. not nested under the workspace).
- TypeScript `strict: true` for all `src/**/*.ts` changes; match existing file style (see `src/config.ts`, `src/agent/settingsStore.ts`) — don't reformat unrelated code.
- Backend tests use `node:test` + `node:assert/strict`, following the existing pattern in `src/config.test.ts` / `src/agent/settingsStore.test.ts` (build an isolated env/opts object per test, never mutate `process.env` directly without restoring it in a `finally`).

---

### Task 1: `src/config.ts` — add `systemDir`, repoint `agentsConfigPath` default

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

**Interfaces:**
- Produces: `AppConfig.systemDir: string` and `AppConfig.agentsConfigPath` now defaults to `<systemDir>/config/agents.json` instead of `./agents.json`. `loadConfig(env?)` signature unchanged.

- [ ] **Step 1: Write the failing tests in `src/config.test.ts`**

Add these tests (keep the existing ones in the file unchanged except where noted in Step 3):

```ts
test("loadConfig applies ~/.jarvis-bridge-system default for systemDir and derives agentsConfigPath from it", () => {
  const cfg = loadConfig(env({}));
  assert.equal(cfg.systemDir, path.join(os.homedir(), ".jarvis-bridge-system"));
  assert.equal(
    cfg.agentsConfigPath,
    path.join(os.homedir(), ".jarvis-bridge-system", "config", "agents.json"),
  );
});

test("loadConfig respects JARVIS_BRIDGE_SYSTEM_DIR (with ~ expansion)", () => {
  const cfg = loadConfig(env({ JARVIS_BRIDGE_SYSTEM_DIR: "~/my-sys" }));
  assert.equal(cfg.systemDir, path.join(os.homedir(), "my-sys"));
  assert.equal(cfg.agentsConfigPath, path.join(os.homedir(), "my-sys", "config", "agents.json"));
});

test("loadConfig: explicit JARVIS_BRIDGE_AGENTS_CONFIG still overrides the systemDir-derived default", () => {
  const cfg = loadConfig(
    env({ JARVIS_BRIDGE_SYSTEM_DIR: "~/my-sys", JARVIS_BRIDGE_AGENTS_CONFIG: "./custom-agents.json" }),
  );
  assert.equal(cfg.agentsConfigPath, "./custom-agents.json");
});
```

Also update the existing default-values test (it currently asserts the old `"./agents.json"` default):

```ts
test("loadConfig applies defaults when no env provided", () => {
  const cfg = loadConfig(env({}));
  assert.equal(cfg.port, 3001);
  assert.equal(cfg.workspace, path.join(os.homedir(), ".jarvis-bridge"));
  assert.equal(cfg.systemDir, path.join(os.homedir(), ".jarvis-bridge-system"));
  assert.equal(
    cfg.agentsConfigPath,
    path.join(os.homedir(), ".jarvis-bridge-system", "config", "agents.json"),
  );
  assert.equal(cfg.defaultBackendEnv, undefined);
  assert.equal(cfg.autoApprove, false);
  assert.equal(cfg.shell, true);
  assert.equal(cfg.slackToken, undefined);
  assert.equal(cfg.gatewayUrl, "http://localhost:3001");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/config.test.ts`
Expected: FAIL — `cfg.systemDir` is `undefined`, and the default-values / AGENTS_CONFIG assertions on `agentsConfigPath` fail against the old `"./agents.json"` value.

- [ ] **Step 3: Implement in `src/config.ts`**

Replace the full file with:

```ts
// Env → typed config. Pure parsing — no side effects on the filesystem
// beyond expanding `~` in workspace paths.

import os from "node:os";
import path from "node:path";

export interface AppConfig {
  port: number;
  workspace: string;
  systemDir: string;
  agentsConfigPath: string;
  defaultBackendEnv?: string;
  autoApprove: boolean;
  shell: boolean;
  slackToken?: string;
  gatewayUrl: string;
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function boolOpt(v: string | undefined, enableValue: "true" | "false" = "true"): boolean {
  if (enableValue === "true") return v === "true";
  return v !== "false";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const workspace = expandHome(
    env.JARVIS_BRIDGE_WORKSPACE ?? "~/.jarvis-bridge",
  );
  // Sibling to `workspace`, never nested under it — deliberately outside
  // pathGuard's boundary so agents.json/settings.json/session_metadata.json
  // (backend spawn commands, potential secrets in agents.json's `env`) are
  // never reachable through the agent's own sandboxed file tools.
  const systemDir = expandHome(
    env.JARVIS_BRIDGE_SYSTEM_DIR ?? "~/.jarvis-bridge-system",
  );
  const port = Number(env.PORT ?? 3001);
  const agentsConfigPath =
    env.JARVIS_BRIDGE_AGENTS_CONFIG ?? path.join(systemDir, "config", "agents.json");
  return {
    port,
    workspace,
    systemDir,
    agentsConfigPath,
    defaultBackendEnv: env.JARVIS_BRIDGE_DEFAULT_BACKEND?.trim() || undefined,
    autoApprove: boolOpt(env.AGENT_AUTO_APPROVE),
    shell: boolOpt(env.JARVIS_BRIDGE_SHELL, "false"),
    slackToken: env.SLACK_BOT_TOKEN?.trim() || undefined,
    gatewayUrl: env.JARVIS_BRIDGE_GATEWAY_URL ?? "http://localhost:3001",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/config.test.ts`
Expected: PASS, all tests including the three new ones.

- [ ] **Step 5: Run full backend typecheck**

Run: `npm run typecheck`
Expected: no errors (no other file references `AppConfig` fields removed/renamed — `systemDir` is additive).

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add JARVIS_BRIDGE_SYSTEM_DIR, derive agentsConfigPath default from it"
```

---

### Task 2: `src/index.ts` — persist settings/session state to `systemDir`

**Files:**
- Modify: `src/index.ts:28-45`

**Interfaces:**
- Consumes: `AppConfig.systemDir` (Task 1). `createSettingsStore(opts: { path, envDefault, validNames })` and `createSessionConfigStore(opts: { path, envDefault })` are unchanged (`src/agent/settingsStore.ts`, `src/agent/sessionConfigStore.ts`) — only the `path` argument passed to them changes.

No test file changes: `src/index.ts` has no dedicated `node:test` file today (it's the process entrypoint, verified via manual runs — this matches existing convention, see `src/index.test.ts` search returning no result). Verification for this task is manual, via Task 8's end-to-end check, since it depends on `scripts/setup.js` (Task 4) actually producing a valid `agents.json` first.

- [ ] **Step 1: Edit `src/index.ts`**

Replace lines 28–45 (from `// 1. Ensure workspace dir exists...` through the end of the `sessionConfig` block) with:

```ts
  // 1. Ensure workspace + system dirs exist. `workspace` is the agent cwd +
  // tools realpath root; `systemDir/config` holds agents.json and friends,
  // kept outside the agent's sandbox (see src/config.ts).
  await fs.mkdir(cfg.workspace, { recursive: true });
  await fs.mkdir(path.join(cfg.systemDir, "config"), { recursive: true });
  console.log(`[jarvis-bridge] workspace ${cfg.workspace}`);

  // 2. Load backend profiles + the runtime default-backend setting.
  const profiles = await loadBackendProfiles(cfg.agentsConfigPath);
  const settings = await createSettingsStore({
    path: path.join(cfg.systemDir, "settings.json"),
    envDefault: cfg.defaultBackendEnv ?? profiles[0].name,
    validNames: profiles.map((p) => p.name),
  });

  // 3a. Session-scoped config (auto-approve default/overrides, session
  // metadata) — persisted to the system dir so it survives restarts and
  // stays out of the agent's own sandboxed file tools.
  const sessionConfig = await createSessionConfigStore({
    path: path.join(cfg.systemDir, "session_metadata.json"),
    envDefault: cfg.autoApprove,
  });
```

Every other line in `src/index.ts` (the `registry`, `tools`, `server`, `attachTerminalServer` calls, all of which use `cfg.workspace` for the agent sandbox, not for settings/session state) stays unchanged.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: persist settings.json/session_metadata.json to systemDir instead of the agent workspace"
```

---

### Task 3: npm workspace merge

**Files:**
- Modify: `package.json:1-6`

**Interfaces:** none (build/config only).

- [ ] **Step 1: Edit root `package.json`**

Add a `"workspaces"` field right after `"private": true`:

```json
{
  "name": "jarvis-bridge",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["frontend"],
  "main": "dist/index.js",
```

- [ ] **Step 2: Verify the merge works**

```bash
rm -rf node_modules frontend/node_modules
npm install
```
Expected: install completes with one command; `ls frontend/node_modules` shows frontend's dependencies present (npm workspaces hoists most of them into the root `node_modules`, symlinking `frontend` itself isn't needed here since it's a real subdirectory, not a workspace package meant to be `require`d elsewhere — confirm no errors and `npm run typecheck && npm run build:web` both still succeed).

Run: `npm run typecheck && npm run build:web`
Expected: both succeed, `public/` gets rebuilt.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: merge frontend/ into an npm workspace so one npm install covers both packages"
```

---

### Task 4: `scripts/setup.js` — migration, backend detection, config scaffolding

**Files:**
- Create: `scripts/setup.js`
- Create: `scripts/setup.test.js`

**Interfaces:**
- Produces (all exported from `scripts/setup.js`, consumed by Task 6's `bin/jarvis-bridge.js`):
  - `resolvePaths(env: NodeJS.ProcessEnv): { workspace, systemDir, configDir, agentsJsonPath, settingsJsonPath, sessionMetaPath }` (all strings)
  - `runSetup(env?: NodeJS.ProcessEnv, log?: (msg: string) => void, repoRoot?: string): ReturnType<typeof resolvePaths>`
  - `detectBackends(pathEnv?: string): Array<{ name: string; kind: string; command: string; args: string[]; env: Record<string, string> }>`
  - `ensureAgentsJson(p: ReturnType<typeof resolvePaths>, repoRoot: string, pathEnv: string | undefined, log: (msg: string) => void): { created: boolean; detected: Array<...> }`
  - `ensureEnvFile(repoRoot: string, log: (msg: string) => void): boolean`
  - `migrateFile(from: string, to: string, log: (msg: string) => void): boolean`
  - `migrateOldState(p: ReturnType<typeof resolvePaths>, repoRoot: string, log: (msg: string) => void): void`
  - `ensureDirs(p: ReturnType<typeof resolvePaths>): void`
  - `expandHome(p: string): string`
  - `KNOWN_BACKENDS: Array<{ detectBinary: string; profile: {...} }>`

- [ ] **Step 1: Write `scripts/setup.test.js` (failing tests first)**

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolvePaths,
  migrateFile,
  ensureAgentsJson,
  ensureEnvFile,
  detectBackends,
  runSetup,
} = require("./setup");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jb-setup-"));
}

// A scratch "repo root" fixture with its own agents.json.example /
// .env.example, so tests never touch the real project's files.
function tmpRepoRoot() {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, "agents.json.example"),
    JSON.stringify({ backends: [{ name: "opencode", kind: "opencode", command: "opencode", args: ["acp"], env: {} }] }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, ".env.example"), "SLACK_BOT_TOKEN=\n", "utf8");
  return dir;
}

test("resolvePaths applies ~/.jarvis-bridge and ~/.jarvis-bridge-system defaults", () => {
  const p = resolvePaths({});
  assert.equal(p.workspace, path.join(os.homedir(), ".jarvis-bridge"));
  assert.equal(p.systemDir, path.join(os.homedir(), ".jarvis-bridge-system"));
  assert.equal(p.agentsJsonPath, path.join(os.homedir(), ".jarvis-bridge-system", "config", "agents.json"));
  assert.equal(p.settingsJsonPath, path.join(os.homedir(), ".jarvis-bridge-system", "settings.json"));
  assert.equal(p.sessionMetaPath, path.join(os.homedir(), ".jarvis-bridge-system", "session_metadata.json"));
});

test("resolvePaths respects JARVIS_BRIDGE_WORKSPACE / JARVIS_BRIDGE_SYSTEM_DIR overrides", () => {
  const p = resolvePaths({ JARVIS_BRIDGE_WORKSPACE: "/tmp/ws", JARVIS_BRIDGE_SYSTEM_DIR: "/tmp/sys" });
  assert.equal(p.workspace, "/tmp/ws");
  assert.equal(p.systemDir, "/tmp/sys");
  assert.equal(p.agentsJsonPath, path.join("/tmp/sys", "config", "agents.json"));
});

test("migrateFile moves an old-location file into the new location", () => {
  const dir = tmpDir();
  const from = path.join(dir, "old.json");
  const to = path.join(dir, "sub", "new.json");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(from, "{}", "utf8");
  const logs = [];
  const moved = migrateFile(from, to, (m) => logs.push(m));
  assert.equal(moved, true);
  assert.equal(fs.existsSync(from), false);
  assert.equal(fs.existsSync(to), true);
  assert.equal(logs.length, 1);
});

test("migrateFile does not overwrite an existing new-location file", () => {
  const dir = tmpDir();
  const from = path.join(dir, "old.json");
  const to = path.join(dir, "new.json");
  fs.writeFileSync(from, '{"stale":true}', "utf8");
  fs.writeFileSync(to, '{"current":true}', "utf8");
  const moved = migrateFile(from, to, () => {});
  assert.equal(moved, false);
  assert.equal(fs.readFileSync(to, "utf8"), '{"current":true}');
});

test("migrateFile is a no-op when the source file doesn't exist", () => {
  const dir = tmpDir();
  const moved = migrateFile(path.join(dir, "missing.json"), path.join(dir, "new.json"), () => {});
  assert.equal(moved, false);
});

test("detectBackends finds nothing when PATH is empty", () => {
  assert.deepEqual(detectBackends(""), []);
});

test("detectBackends finds a fake `opencode` executable placed on PATH", () => {
  const dir = tmpDir();
  const fakeBinDir = path.join(dir, "bin");
  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.writeFileSync(path.join(fakeBinDir, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
  const found = detectBackends(fakeBinDir);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "opencode");
});

test("ensureAgentsJson writes the example file when no backend CLI is on PATH", () => {
  const dir = tmpDir();
  const repoRoot = tmpRepoRoot();
  const configDir = path.join(dir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const p = { agentsJsonPath: path.join(configDir, "agents.json") };
  const result = ensureAgentsJson(p, repoRoot, "", () => {});
  assert.equal(result.created, true);
  assert.deepEqual(result.detected, []);
  const written = JSON.parse(fs.readFileSync(p.agentsJsonPath, "utf8"));
  assert.ok(Array.isArray(written.backends) && written.backends.length > 0);
});

test("ensureAgentsJson writes only detected backends when a known CLI is on PATH", () => {
  const dir = tmpDir();
  const repoRoot = tmpRepoRoot();
  const configDir = path.join(dir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const fakeBinDir = path.join(dir, "bin");
  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.writeFileSync(path.join(fakeBinDir, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
  const p = { agentsJsonPath: path.join(configDir, "agents.json") };
  const result = ensureAgentsJson(p, repoRoot, fakeBinDir, () => {});
  assert.equal(result.created, true);
  assert.equal(result.detected.length, 1);
  assert.equal(result.detected[0].name, "opencode");
  const written = JSON.parse(fs.readFileSync(p.agentsJsonPath, "utf8"));
  assert.equal(written.backends.length, 1);
  assert.equal(written.backends[0].name, "opencode");
});

test("ensureAgentsJson is a no-op when agents.json already exists", () => {
  const dir = tmpDir();
  const repoRoot = tmpRepoRoot();
  const configDir = path.join(dir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const agentsJsonPath = path.join(configDir, "agents.json");
  fs.writeFileSync(agentsJsonPath, '{"backends":[{"name":"custom"}]}', "utf8");
  const result = ensureAgentsJson({ agentsJsonPath }, repoRoot, "", () => {});
  assert.equal(result.created, false);
  assert.equal(fs.readFileSync(agentsJsonPath, "utf8"), '{"backends":[{"name":"custom"}]}');
});

test("ensureEnvFile copies .env.example to .env when missing, no-ops when present", () => {
  const repoRoot = tmpRepoRoot();
  const first = ensureEnvFile(repoRoot, () => {});
  assert.equal(first, true);
  assert.equal(fs.readFileSync(path.join(repoRoot, ".env"), "utf8"), "SLACK_BOT_TOKEN=\n");

  fs.writeFileSync(path.join(repoRoot, ".env"), "SLACK_BOT_TOKEN=custom\n", "utf8");
  const second = ensureEnvFile(repoRoot, () => {});
  assert.equal(second, false);
  assert.equal(fs.readFileSync(path.join(repoRoot, ".env"), "utf8"), "SLACK_BOT_TOKEN=custom\n");
});

test("runSetup migrates old-layout settings.json out of the workspace and scaffolds agents.json", () => {
  const dir = tmpDir();
  const repoRoot = tmpRepoRoot();
  const workspace = path.join(dir, "workspace");
  const systemDir = path.join(dir, "system");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "settings.json"), '{"defaultBackendName":"opencode"}', "utf8");

  const p = runSetup(
    { JARVIS_BRIDGE_WORKSPACE: workspace, JARVIS_BRIDGE_SYSTEM_DIR: systemDir, PATH: "" },
    () => {},
    repoRoot,
  );

  assert.equal(fs.existsSync(path.join(workspace, "settings.json")), false);
  assert.equal(fs.existsSync(p.settingsJsonPath), true);
  assert.equal(
    fs.readFileSync(p.settingsJsonPath, "utf8"),
    '{"defaultBackendName":"opencode"}',
  );
  assert.equal(fs.existsSync(p.agentsJsonPath), true);
});

test("runSetup is idempotent — a second run makes no further changes", () => {
  const dir = tmpDir();
  const repoRoot = tmpRepoRoot();
  const workspace = path.join(dir, "workspace");
  const systemDir = path.join(dir, "system");
  const env = { JARVIS_BRIDGE_WORKSPACE: workspace, JARVIS_BRIDGE_SYSTEM_DIR: systemDir, PATH: "" };

  runSetup(env, () => {}, repoRoot);
  const agentsJsonPath = path.join(systemDir, "config", "agents.json");
  const before = fs.readFileSync(agentsJsonPath, "utf8");

  runSetup(env, () => {}, repoRoot);
  const after = fs.readFileSync(agentsJsonPath, "utf8");
  assert.equal(before, after);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/setup.test.js`
Expected: FAIL with `Cannot find module './setup'` (file doesn't exist yet).

- [ ] **Step 3: Implement `scripts/setup.js`**

```js
#!/usr/bin/env node
// One-time (idempotent) setup: migrates any pre-existing state into the
// ~/.jarvis-bridge-system/ layout, scaffolds agents.json by detecting
// installed backend CLIs on PATH, and copies .env.example -> .env.
// Runs automatically via "postinstall"; re-runnable any time via
// `npm run setup`. No prompts — auto-detect + defaults only, so it's safe
// to run non-interactively (npm ci, CI, Docker builds, npx installs).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolvePaths(env) {
  env = env || {};
  const workspace = expandHome(env.JARVIS_BRIDGE_WORKSPACE || "~/.jarvis-bridge");
  const systemDir = expandHome(env.JARVIS_BRIDGE_SYSTEM_DIR || "~/.jarvis-bridge-system");
  const configDir = path.join(systemDir, "config");
  return {
    workspace,
    systemDir,
    configDir,
    agentsJsonPath: path.join(configDir, "agents.json"),
    settingsJsonPath: path.join(systemDir, "settings.json"),
    sessionMetaPath: path.join(systemDir, "session_metadata.json"),
  };
}

function ensureDirs(p) {
  fs.mkdirSync(p.workspace, { recursive: true });
  fs.mkdirSync(p.configDir, { recursive: true });
}

// Moves `from` to `to` only if `from` exists and `to` doesn't yet, so it
// never clobbers state already migrated (or created fresh) in the new
// location, and is safe to call on every run.
function migrateFile(from, to, log) {
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    fs.renameSync(from, to);
    log(`migrated ${from} -> ${to}`);
    return true;
  }
  return false;
}

function migrateOldState(p, repoRoot, log) {
  migrateFile(path.join(p.workspace, "settings.json"), p.settingsJsonPath, log);
  migrateFile(path.join(p.workspace, "session_metadata.json"), p.sessionMetaPath, log);
  migrateFile(path.join(repoRoot, "agents.json"), p.agentsJsonPath, log);
}

// Known backend CLIs setup can auto-detect. `detectBinary` is the
// executable checked for on PATH; `profile` is what gets written into
// agents.json when it's found.
const KNOWN_BACKENDS = [
  {
    detectBinary: "opencode",
    profile: { name: "opencode", kind: "opencode", command: "opencode", args: ["acp"], env: {} },
  },
  {
    detectBinary: "claude",
    profile: {
      name: "claude",
      kind: "claude-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
      env: {},
    },
  },
];

function findOnPath(binName, pathEnv) {
  const dirs = String(pathEnv || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binName + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // not here, keep looking
      }
    }
  }
  return null;
}

function detectBackends(pathEnv) {
  const effective = pathEnv === undefined ? process.env.PATH : pathEnv;
  return KNOWN_BACKENDS.filter((b) => findOnPath(b.detectBinary, effective) !== null).map(
    (b) => b.profile,
  );
}

function ensureAgentsJson(p, repoRoot, pathEnv, log) {
  if (fs.existsSync(p.agentsJsonPath)) return { created: false, detected: [] };
  const detected = detectBackends(pathEnv);
  if (detected.length > 0) {
    fs.writeFileSync(p.agentsJsonPath, JSON.stringify({ backends: detected }, null, 2) + "\n", "utf8");
    log(`wrote ${p.agentsJsonPath} (auto-detected: ${detected.map((d) => d.name).join(", ")})`);
    return { created: true, detected };
  }
  const examplePath = path.join(repoRoot, "agents.json.example");
  fs.copyFileSync(examplePath, p.agentsJsonPath);
  log(`wrote ${p.agentsJsonPath} from agents.json.example — no known backend CLI found on PATH, edit it by hand`);
  return { created: true, detected: [] };
}

function ensureEnvFile(repoRoot, log) {
  const envPath = path.join(repoRoot, ".env");
  const examplePath = path.join(repoRoot, ".env.example");
  if (fs.existsSync(envPath)) return false;
  fs.copyFileSync(examplePath, envPath);
  log(`wrote ${envPath} from .env.example`);
  return true;
}

function runSetup(env, log, repoRoot) {
  env = env || process.env;
  log = log || console.log;
  repoRoot = repoRoot || REPO_ROOT;

  const p = resolvePaths(env);
  ensureDirs(p);
  migrateOldState(p, repoRoot, log);
  const agentsResult = ensureAgentsJson(p, repoRoot, env.PATH, log);
  ensureEnvFile(repoRoot, log);

  log("[jarvis-bridge setup] done.");
  if (agentsResult.created && agentsResult.detected.length === 0) {
    log(`[jarvis-bridge setup] edit ${p.agentsJsonPath} before running npm run dev.`);
  } else {
    log("[jarvis-bridge setup] run `npm run dev` to start the gateway.");
  }
  return p;
}

module.exports = {
  expandHome,
  resolvePaths,
  ensureDirs,
  migrateFile,
  migrateOldState,
  findOnPath,
  detectBackends,
  ensureAgentsJson,
  ensureEnvFile,
  runSetup,
  KNOWN_BACKENDS,
};

if (require.main === module) {
  runSetup();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/setup.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/setup.js scripts/setup.test.js
git commit -m "feat: add scripts/setup.js — state migration + backend auto-detect + config scaffolding"
```

---

### Task 5: Wire `postinstall`/`npm run setup`, include `scripts/` in the test glob

**Files:**
- Modify: `package.json` (`scripts` block)
- Modify: `AGENTS.md:14` (single test file command references stay accurate; the `npm test` glob description needs updating)

**Interfaces:** none new — wires Task 4's `scripts/setup.js` into the npm lifecycle.

- [ ] **Step 1: Edit `package.json`'s `scripts` block**

```json
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test 'src/**/*.test.ts' 'scripts/**/*.test.js'",
    "setup": "node scripts/setup.js",
    "postinstall": "node scripts/setup.js",
    "dev:web": "cd frontend && npm run dev",
    "build:web": "cd frontend && npm run build",
    "preview:web": "cd frontend && npm run preview",
    "test:web": "cd frontend && npm test -- --run"
  },
```

- [ ] **Step 2: Run full backend test suite**

Run: `npm test`
Expected: PASS — both `src/**/*.test.ts` and `scripts/**/*.test.js` run (confirm `scripts/setup.test.js`'s tests show up in the output).

- [ ] **Step 3: Verify `postinstall` actually fires**

```bash
npm install
```
Expected output includes lines from `scripts/setup.js`'s `runSetup` (e.g. `[jarvis-bridge setup] done.`) after the dependency install completes. Confirm `~/.jarvis-bridge-system/config/agents.json` now exists (this is expected to pick up your real local `opencode`/`claude` CLIs if installed, or migrate your existing repo-root `agents.json` — see Task 8 for the full before/after check).

- [ ] **Step 4: Update `AGENTS.md`'s "Build & test" section**

In the `## Build & test` section, change:
```
npm test              # node --test over src/**/*.test.ts (TS_NODE_TRANSPILE_ONLY=true)
```
to:
```
npm test              # node --test over src/**/*.test.ts + scripts/**/*.test.js (TS_NODE_TRANSPILE_ONLY=true)
```

- [ ] **Step 5: Commit**

```bash
git add package.json AGENTS.md
git commit -m "feat: wire scripts/setup.js into postinstall + npm run setup"
```

---

### Task 6: `bin/jarvis-bridge.js` — npx / zero-clone entry point

**Files:**
- Create: `bin/jarvis-bridge.js`
- Modify: `package.json` (add `bin` field only — no `prepare` script; see note below)

**Interfaces:**
- Consumes: `scripts/setup.js`'s `runSetup()` (Task 4), `dist/index.js` (built by `npm run build`).

**Design note:** npm's `prepare` lifecycle hook fires for git-sourced installs (what
`npx github:...` needs) but *also* fires on every plain local `npm install` run in the
package's own directory — there's no way to scope it to "git/npx installs only." Wiring
`"prepare": "npm run build && npm run build:web"` would silently turn every future local
`npm install` into a full tsc+vite rebuild, which is a real cost nobody asked for. Instead,
`bin/jarvis-bridge.js` builds lazily, itself, only when `dist/`/`public/` don't already
exist — so a git/npx install still ends up fully built on first run, while local dev's
`npm install` stays fast and unaffected.

- [ ] **Step 1: Create `bin/jarvis-bridge.js`**

```js
#!/usr/bin/env node
// npx entry point (`npx github:<owner>/jarvis_bridge`). Lazily builds
// dist/ and public/ if they're missing (a fresh git/npx checkout has
// neither — devDependencies like typescript/vite are present since npm
// installs them by default), runs the same idempotent setup as
// `npm run setup`, then starts the built gateway.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..");
const distEntry = path.join(REPO_ROOT, "dist", "index.js");
const publicIndex = path.join(REPO_ROOT, "public", "index.html");

if (!fs.existsSync(distEntry) || !fs.existsSync(publicIndex)) {
  execFileSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
  execFileSync("npm", ["run", "build:web"], { cwd: REPO_ROOT, stdio: "inherit" });
}

const { runSetup } = require("../scripts/setup");

runSetup();
require(distEntry);
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x bin/jarvis-bridge.js
```

- [ ] **Step 3: Add `bin` to `package.json`**

Add alongside the existing `"main"` field:

```json
  "main": "dist/index.js",
  "bin": {
    "jarvis-bridge": "./bin/jarvis-bridge.js"
  },
```

- [ ] **Step 4: Verify locally (simulating the npx flow without needing a real npx github: run)**

```bash
rm -rf dist public
JARVIS_BRIDGE_WORKSPACE=/tmp/jb-smoke-ws JARVIS_BRIDGE_SYSTEM_DIR=/tmp/jb-smoke-sys node bin/jarvis-bridge.js
```
Expected: the script detects `dist/index.js`/`public/index.html` are missing, runs the build steps itself (visible `tsc`/`vite build` output), then setup runs against the scratch `/tmp/jb-smoke-*` paths (not your real `~/.jarvis-bridge*`), then the gateway starts and logs `[jarvis-bridge] gateway listening on http://localhost:3001`. Confirm with:
```bash
curl -s http://localhost:3001/health
```
Expected: a 200 response. Stop the process with Ctrl+C, then run it again — this time expect it to skip straight to setup (no rebuild, since `dist/`/`public/` now exist). Clean up:
```bash
rm -rf /tmp/jb-smoke-ws /tmp/jb-smoke-sys
```

- [ ] **Step 5: Commit**

```bash
git add bin/jarvis-bridge.js package.json
git commit -m "feat: add bin/jarvis-bridge.js — lazy-build + setup entry point for npx github: installs"
```

---

### Task 7: Docs sync — README.md, AGENTS.md

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` (Backend configuration section)

No code interfaces — documentation only. `.gitignore` needs no changes: `agents.json` stays ignored (still relevant if someone overrides `JARVIS_BRIDGE_AGENTS_CONFIG` back to a repo-relative path) and the new `~/.jarvis-bridge-system/` path is outside the repo entirely, so there's nothing new to ignore — confirm this by inspecting `.gitignore` rather than editing it.

- [ ] **Step 1: Rewrite README's "How it works" step 2 and step 3**

Change:
```
2. Ensures the workspace directory exists (this becomes the agent's default cwd).
3. Spawns the ACP agent as a subprocess (or falls back to a stub backend if `AGENT_CMD` is unset).
```
to:
```
2. Ensures the workspace directory (`~/.jarvis-bridge`) and system state directory
   (`~/.jarvis-bridge-system`, holding `agents.json`/`settings.json`/`session_metadata.json`)
   exist, creating them if missing.
3. Spawns the ACP agent as a subprocess per the profiles in `agents.json`.
```

(Step 3's old text described a stub-backend fallback keyed on `AGENT_CMD`, an env var that no longer exists in `.env.example` — there is no stub backend in the current code; this was stale before this change and is being corrected as part of this doc-sync pass.)

- [ ] **Step 2: Rewrite the "Getting started" section**

Replace:
```markdown
## Getting started

```bash
npm install
cp .env.example .env   # then edit AGENT_CMD / AGENT_ARGS etc.
npm run dev
```

The gateway listens on `http://localhost:3001` by default.
```
with:
```markdown
## Getting started

```bash
npm install
npm run dev
```

`npm install` installs both backend and frontend dependencies (they're an npm workspace)
and automatically runs `scripts/setup.js` (via `postinstall`): it scaffolds
`~/.jarvis-bridge-system/config/agents.json`, pre-filled with any backend CLI (`opencode`,
`claude`, ...) it finds on your `PATH`, and copies `.env.example` to `.env`. It never
overwrites files that already exist — re-run it any time with `npm run setup` (e.g. after
installing a new backend CLI).

No local clone? Try it directly:

```bash
npx github:bhanu-mac/jarvis_bridge
```

The gateway listens on `http://localhost:3001` by default.
```

- [ ] **Step 3: Fix the Configuration table**

Replace the table (currently listing stale `AGENT_CMD`/`AGENT_ARGS`/`AGENT_MODEL` rows) with:
```markdown
| Variable | Purpose |
|---|---|
| `JARVIS_BRIDGE_WORKSPACE` | Workspace root / agent cwd (default `~/.jarvis-bridge`) |
| `JARVIS_BRIDGE_SYSTEM_DIR` | State dir for `agents.json`/`settings.json`/`session_metadata.json`, never agent-readable (default `~/.jarvis-bridge-system`) |
| `PORT` | Gateway HTTP port (default `3001`) |
| `JARVIS_BRIDGE_AGENTS_CONFIG` | Path to `agents.json` (default `<systemDir>/config/agents.json`) |
| `JARVIS_BRIDGE_DEFAULT_BACKEND` | Default backend name, seeds `settings.json` on first run |
| `AGENT_AUTO_APPROVE` | Backend-wide default for the auto-approve toggle |
| `JARVIS_BRIDGE_SHELL` | Set `false` to disable the WebSocket terminal drawer |
| `SLACK_BOT_TOKEN` | Enables `POST /slack/message` |
| `JARVIS_BRIDGE_GATEWAY_URL` | Gateway URL used by the optional stdio MCP server |
```

And remove the now-inapplicable sentence right after the table (`If AGENT_CMD is left empty, the gateway runs against an in-memory stub backend...`) — delete it entirely, since `agents.json` is always required now (scaffolded automatically by setup, not left empty).

- [ ] **Step 4: Update the Scripts table**

Add a row for `npm run setup` right after `npm run dev`:
```markdown
| `npm run setup` | Re-run backend auto-detect + config scaffolding (also runs automatically on `npm install`) |
```

- [ ] **Step 5: Update `AGENTS.md`'s "Backend configuration" section**

Change:
```
- `agents.json` (copy from `agents.json.example`; gitignored) lists named backend
  profiles: `{ name, kind, command, args, env }`. `src/agent/backendConfig.ts` loads it.
- `settings.json` (gitignored, runtime-writable) holds the user's default-backend
  override, settable via `GET/PUT /settings/default-backend`.
- `session_metadata.json` (gitignored, in the workspace dir) persists auto-approve
```
to:
```
- `agents.json` (default `~/.jarvis-bridge-system/config/agents.json`, scaffolded by
  `scripts/setup.js` — see below) lists named backend profiles:
  `{ name, kind, command, args, env }`. `src/agent/backendConfig.ts` loads it.
- `settings.json` (default `~/.jarvis-bridge-system/settings.json`, runtime-writable)
  holds the user's default-backend override, settable via `GET/PUT /settings/default-backend`.
- `session_metadata.json` (default `~/.jarvis-bridge-system/session_metadata.json`)
  persists auto-approve
```

(keep the rest of that bullet's text — "state (backend-wide default..." onward — unchanged)

Immediately after the `docs/agent-claude-code.md` bullet, add a new bullet:
```
- `~/.jarvis-bridge-system/` (default; override via `JARVIS_BRIDGE_SYSTEM_DIR`) is a
  sibling of the agent's sandboxed workspace (`~/.jarvis-bridge`, `JARVIS_BRIDGE_WORKSPACE`),
  never nested under it — this keeps `agents.json`'s backend spawn commands/env (which can
  carry secrets) and `settings.json`/`session_metadata.json` outside what the agent's own
  `readFile`/`writeFile` tools can reach via `pathGuard`. `scripts/setup.js` migrates
  pre-existing files from the old locations (repo-root `agents.json`, workspace-nested
  `settings.json`/`session_metadata.json`) into the new layout on first run — see
  `docs/superpowers/specs/2026-07-21-setup-simplification-design.md`.
```

Also, right after the `## Build & test` code block's frontend section, note the workspace merge — change:
```
Frontend (`frontend/`, separate npm workspace — not an npm workspaces link, just a subdir with its own `package.json`):
```
to:
```
Frontend (`frontend/`, an npm workspace — root `npm install` installs its dependencies too):
```

- [ ] **Step 6: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: sync README/AGENTS.md with the new setup flow and ~/.jarvis-bridge-system layout"
```

---

### Task 8: End-to-end verification

**Files:** none (manual verification only).

- [ ] **Step 1: Fresh-clone smoke test**

```bash
rm -rf /tmp/jb-e2e && git clone /Users/bhanu-mac/Desktop/Projects/jarvis_bridge /tmp/jb-e2e
cd /tmp/jb-e2e
JARVIS_BRIDGE_WORKSPACE=/tmp/jb-e2e-ws JARVIS_BRIDGE_SYSTEM_DIR=/tmp/jb-e2e-sys npm install
```
Expected: install completes, `postinstall` output shows `[jarvis-bridge setup] done.`, and `/tmp/jb-e2e-sys/config/agents.json` exists (either auto-detected from your real `opencode`/`claude` CLIs on `PATH`, or copied from the example with the "edit it by hand" hint if neither is installed).

```bash
JARVIS_BRIDGE_WORKSPACE=/tmp/jb-e2e-ws JARVIS_BRIDGE_SYSTEM_DIR=/tmp/jb-e2e-sys npm run dev
```
Expected: gateway starts and logs `backends: ... (default: ...)`. Ctrl+C to stop, then `rm -rf /tmp/jb-e2e /tmp/jb-e2e-ws /tmp/jb-e2e-sys`.

- [ ] **Step 2: Migration smoke test (your real local setup)**

Before running, confirm your real state is what you expect:
```bash
ls ~/.jarvis-bridge/settings.json ~/.jarvis-bridge/session_metadata.json 2>/dev/null
ls agents.json 2>/dev/null   # repo-root, from before this change
```
Then in the real repo:
```bash
npm run setup
```
Expected: the files listed above are gone from their old locations, and now exist at `~/.jarvis-bridge-system/settings.json`, `~/.jarvis-bridge-system/session_metadata.json`, and `~/.jarvis-bridge-system/config/agents.json` respectively, with unchanged content (diff old vs. new content before/after if you want to be extra sure — capture a copy first if paranoid: `cp ~/.jarvis-bridge/settings.json /tmp/settings-before.json` etc.).

```bash
npm run dev
```
Expected: gateway starts normally against your real backends, confirming the migrated `agents.json`/`settings.json` are being read correctly from the new location.

- [ ] **Step 3: Confirm the frontend workspace merge didn't break dev/build**

```bash
npm run dev:web
```
Expected: Vite dev server starts on port 5173 as before. Ctrl+C to stop.

```bash
npm run build:web
```
Expected: succeeds, `public/` is repopulated.

- [ ] **Step 4: Run the full test suite one more time**

```bash
npm run typecheck && npm test && npm run test:web
```
Expected: all pass.
