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

test("setDefaultBackendName preserves other keys already in the file", async () => {
  const p = await tmpPath();
  await fs.writeFile(p, JSON.stringify({ defaultBackendName: "opencode", configDefaults: { claude: { effort: "high" } } }), "utf8");
  const store = await createSettingsStore({ path: p, envDefault: "opencode", validNames: ["opencode", "claude"] });
  await store.setDefaultBackendName("claude");
  const onDisk = JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
  assert.equal(onDisk.defaultBackendName, "claude");
  assert.deepEqual(onDisk.configDefaults, { claude: { effort: "high" } });
});

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
