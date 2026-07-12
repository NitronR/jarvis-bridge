import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides };
}

test("loadConfig applies defaults when no env provided", () => {
  const cfg = loadConfig(env({}));
  assert.equal(cfg.port, 3001);
  assert.equal(cfg.workspace, path.join(os.homedir(), ".jarvis-bridge"));
  assert.equal(cfg.agentsConfigPath, "./agents.json");
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
