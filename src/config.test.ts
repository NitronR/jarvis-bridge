import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config";
import { DEFAULT_DEMO_CONFIG_PATH } from "./demo/config";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides };
}

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

test("loadConfig respects PORT, JARVIS_BRIDGE_WORKSPACE (with ~ expansion)", () => {
  const cfg = loadConfig(
    env({ PORT: "4242", JARVIS_BRIDGE_WORKSPACE: "~/my-ws" }),
  );
  assert.equal(cfg.port, 4242);
  assert.equal(cfg.workspace, path.join(os.homedir(), "my-ws"));
});

test("loadConfig parses JARVIS_BRIDGE_AGENTS_CONFIG + JARVIS_BRIDGE_DEFAULT_BACKEND", () => {
  const cfg = loadConfig(
    env({ JARVIS_BRIDGE_AGENTS_CONFIG: "./custom-agents.json", JARVIS_BRIDGE_DEFAULT_BACKEND: "my-default" }),
  );
  assert.equal(cfg.agentsConfigPath, "./custom-agents.json");
  assert.equal(cfg.defaultBackendEnv, "my-default");
});

test("loadConfig: AGENT_AUTO_APPROVE only enables on literal 'true'", () => {
  assert.equal(loadConfig(env({ AGENT_AUTO_APPROVE: "true" })).autoApprove, true);
  assert.equal(loadConfig(env({ AGENT_AUTO_APPROVE: "True" })).autoApprove, false);
  assert.equal(loadConfig(env({ AGENT_AUTO_APPROVE: "1" })).autoApprove, false);
  assert.equal(loadConfig(env({ AGENT_AUTO_APPROVE: "" })).autoApprove, false);
});

test("loadConfig: SLACK_BOT_TOKEN captured when set", () => {
  const cfg = loadConfig(env({ SLACK_BOT_TOKEN: "xoxb-test" }));
  assert.equal(cfg.slackToken, "xoxb-test");
});

test("ensureWorkspace creates the workspace dir if missing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-cfg-"));
  const ws = path.join(tmp, "ws");
  try {
    const cfg = loadConfig(env({ JARVIS_BRIDGE_WORKSPACE: ws }));
    assert.equal(cfg.workspace, ws);
    // loadConfig should not create the dir — the bootstrap layer does.
    const stat = await fs.stat(ws).catch(() => null);
    assert.equal(stat, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

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

test("loadConfig: demo mode is off by default", () => {
  assert.equal(loadConfig(env({})).demo, undefined);
  assert.equal(loadConfig(env({ JARVIS_BRIDGE_DEMO: "1" })).demo, undefined);
});

test("loadConfig: --demo / JARVIS_BRIDGE_DEMO=true enable demo mode with the bundled scenario file", () => {
  for (const cfg of [loadConfig(env({}), ["--demo"]), loadConfig(env({ JARVIS_BRIDGE_DEMO: "true" }))]) {
    assert.deepEqual(cfg.demo, { configPath: DEFAULT_DEMO_CONFIG_PATH });
  }
});

test("loadConfig: demo mode keeps its state in a demo/ subdir of the system dir", () => {
  const cfg = loadConfig(env({ JARVIS_BRIDGE_SYSTEM_DIR: "~/my-sys" }), ["--demo"]);
  const demoDir = path.join(os.homedir(), "my-sys", "demo");
  assert.equal(cfg.systemDir, demoDir);
  assert.equal(cfg.logFile, path.join(demoDir, "logs", "gateway.log"));
  // The workspace is untouched — the mock agent never writes to it.
  assert.equal(cfg.workspace, path.join(os.homedir(), ".jarvis-bridge"));
});

test("loadConfig: JARVIS_BRIDGE_DEMO_CONFIG points demo mode at another scenario file", () => {
  assert.deepEqual(loadConfig(env({ JARVIS_BRIDGE_DEMO_CONFIG: "~/demo.json" }), ["--demo"]).demo, {
    configPath: path.join(os.homedir(), "demo.json"),
  });
  assert.deepEqual(loadConfig(env({ JARVIS_BRIDGE_DEMO_CONFIG: "rel/demo.json" }), ["--demo"]).demo, {
    configPath: path.resolve("rel/demo.json"),
  });
});
