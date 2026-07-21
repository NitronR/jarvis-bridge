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

test("migrateFile falls back to copy+unlink when renameSync throws EXDEV (cross-filesystem move)", () => {
  const dir = tmpDir();
  const from = path.join(dir, "old.json");
  const to = path.join(dir, "sub", "new.json");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(from, '{"cross":"fs"}', "utf8");

  const originalRenameSync = fs.renameSync;
  fs.renameSync = () => {
    const err = new Error("EXDEV: cross-device link not permitted");
    err.code = "EXDEV";
    throw err;
  };
  try {
    const logs = [];
    const moved = migrateFile(from, to, (m) => logs.push(m));
    assert.equal(moved, true);
    assert.equal(fs.existsSync(from), false);
    assert.equal(fs.existsSync(to), true);
    assert.equal(fs.readFileSync(to, "utf8"), '{"cross":"fs"}');
    assert.equal(logs.length, 1);
  } finally {
    fs.renameSync = originalRenameSync;
  }
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
