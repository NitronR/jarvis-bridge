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
