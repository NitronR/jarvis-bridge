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
  assert.equal(cfg.agent.command, "");
  assert.deepEqual(cfg.agent.args, []);
  assert.equal(cfg.agent.model, undefined);
  assert.equal(cfg.agent.autoApprove, false);
  assert.equal(cfg.injectContext, true);
  assert.equal(cfg.injectContextMode, "paths");
  assert.equal(cfg.initialWorkspacePath, "./initial_workspace");
  assert.deepEqual(cfg.initialSkills, []);
  assert.equal(cfg.onboarding, false);
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

test("loadConfig parses AGENT_CMD + AGENT_ARGS (whitespace-split)", () => {
  const cfg = loadConfig(
    env({ AGENT_CMD: "opencode", AGENT_ARGS: "acp --foo bar" }),
  );
  assert.equal(cfg.agent.command, "opencode");
  assert.deepEqual(cfg.agent.args, ["acp", "--foo", "bar"]);
});

test("loadConfig: AGENT_AUTO_APPROVE only enables on literal 'true'", () => {
  assert.equal(loadConfig(env({ AGENT_AUTO_APPROVE: "true" })).agent.autoApprove, true);
  assert.equal(loadConfig(env({ AGENT_AUTO_APPROVE: "True" })).agent.autoApprove, false);
  assert.equal(loadConfig(env({ AGENT_AUTO_APPROVE: "1" })).agent.autoApprove, false);
  assert.equal(loadConfig(env({ AGENT_AUTO_APPROVE: "" })).agent.autoApprove, false);
});

test("loadConfig: INJECT_CONTEXT disables only on literal 'false'", () => {
  assert.equal(loadConfig(env({ INJECT_CONTEXT: "true" })).injectContext, true);
  assert.equal(loadConfig(env({ INJECT_CONTEXT: "yes" })).injectContext, true);
  assert.equal(loadConfig(env({ INJECT_CONTEXT: "" })).injectContext, true);
  assert.equal(loadConfig(env({ INJECT_CONTEXT: "false" })).injectContext, false);
});

test("loadConfig: INJECT_CONTEXT_MODE falls back to 'paths' for unknown values", () => {
  assert.equal(loadConfig(env({ INJECT_CONTEXT_MODE: "full" })).injectContextMode, "full");
  assert.equal(loadConfig(env({ INJECT_CONTEXT_MODE: "bogus" })).injectContextMode, "paths");
  assert.equal(loadConfig(env({ INJECT_CONTEXT_MODE: "" })).injectContextMode, "paths");
});

test("loadConfig: JARVIS_BRIDGE_INITIAL_SKILLS splits csv", () => {
  const cfg = loadConfig(env({ JARVIS_BRIDGE_INITIAL_SKILLS: "alpha, beta,gamma" }));
  assert.deepEqual(cfg.initialSkills, ["alpha", "beta", "gamma"]);
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
