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
