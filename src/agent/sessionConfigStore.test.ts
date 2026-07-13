import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSessionConfigStore } from "./sessionConfigStore";

async function tmpPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jb-session-config-"));
  return path.join(dir, "session_metadata.json");
}

test("seeds default from env when no file exists", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: true });
  assert.equal(store.getAutoApproveDefault(), true);
});

test("persists setAutoApproveDefault and a fresh store picks it up", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.setAutoApproveDefault(true);
  assert.equal(store.getAutoApproveDefault(), true);

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.equal(reloaded.getAutoApproveDefault(), true);
});

test("setAutoApproveOverride stores a per-session value that survives reload", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.setAutoApproveOverride("sess-A", true);
  await store.setAutoApproveOverride("sess-B", false);
  assert.equal(store.getAutoApproveOverride("sess-A"), true);
  assert.equal(store.getAutoApproveOverride("sess-B"), false);
  assert.equal(store.getAutoApproveOverride("sess-C"), undefined);

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.equal(reloaded.getAutoApproveOverride("sess-A"), true);
  assert.equal(reloaded.getAutoApproveOverride("sess-B"), false);
  assert.equal(reloaded.getAutoApproveOverride("sess-C"), undefined);
});

test("setAutoApproveOverride(null) clears the override", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.setAutoApproveOverride("sess-A", true);
  assert.equal(store.getAutoApproveOverride("sess-A"), true);
  await store.setAutoApproveOverride("sess-A", null);
  assert.equal(store.getAutoApproveOverride("sess-A"), undefined);

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.equal(reloaded.getAutoApproveOverride("sess-A"), undefined);
});

test("falls back to envDefault when persisted file is corrupt", async () => {
  const p = await tmpPath();
  await fs.writeFile(p, "{not json", "utf8");
  const store = await createSessionConfigStore({ path: p, envDefault: true });
  assert.equal(store.getAutoApproveDefault(), true);
  assert.equal(store.getAutoApproveOverride("anything"), undefined);
});

test("ignores non-boolean entries in a corrupt-shape file", async () => {
  const p = await tmpPath();
  await fs.writeFile(
    p,
    JSON.stringify({ autoApprove: { default: "yes", overrides: { "sess-A": "maybe" } } }),
    "utf8",
  );
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  // String defaults are ignored — fall through to envDefault.
  assert.equal(store.getAutoApproveDefault(), false);
  // Non-boolean override values are filtered out.
  assert.equal(store.getAutoApproveOverride("sess-A"), undefined);
});

test("getMetadata returns undefined for an unknown sessionId", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  assert.equal(store.getMetadata("never-seen"), undefined);
});

test("setMetadata persists customTitle across reload", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.setMetadata("sess-A", { customTitle: "Project kickoff" });
  assert.deepEqual(store.getMetadata("sess-A"), { customTitle: "Project kickoff" });

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.deepEqual(reloaded.getMetadata("sess-A"), { customTitle: "Project kickoff" });
});

test("setMetadata persists pinned and group across reload", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.setMetadata("sess-A", { pinned: true, group: "work" });
  assert.deepEqual(store.getMetadata("sess-A"), { pinned: true, group: "work" });

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.deepEqual(reloaded.getMetadata("sess-A"), { pinned: true, group: "work" });
});

test("setMetadata patches individual fields without dropping siblings", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.setMetadata("sess-A", { customTitle: "Project kickoff", pinned: true });
  await store.setMetadata("sess-A", { group: "work" });
  assert.deepEqual(store.getMetadata("sess-A"), {
    customTitle: "Project kickoff",
    pinned: true,
    group: "work",
  });

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.deepEqual(reloaded.getMetadata("sess-A"), {
    customTitle: "Project kickoff",
    pinned: true,
    group: "work",
  });
});

test("setMetadata with customTitle=null clears just that field", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.setMetadata("sess-A", { customTitle: "Project kickoff", pinned: true });
  await store.setMetadata("sess-A", { customTitle: null });
  assert.deepEqual(store.getMetadata("sess-A"), { pinned: true });

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.deepEqual(reloaded.getMetadata("sess-A"), { pinned: true });
});

test("setMetadata coexists with autoApprove entries in the same file", async () => {
  const p = await tmpPath();
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  await store.setAutoApproveOverride("sess-A", true);
  await store.setMetadata("sess-A", { customTitle: "Project kickoff" });

  const reloaded = await createSessionConfigStore({ path: p, envDefault: false });
  assert.equal(reloaded.getAutoApproveOverride("sess-A"), true);
  assert.deepEqual(reloaded.getMetadata("sess-A"), { customTitle: "Project kickoff" });
});

test("setMetadata ignores non-string customTitle / non-boolean pinned / non-string group on load", async () => {
  const p = await tmpPath();
  await fs.writeFile(
    p,
    JSON.stringify({
      metadata: {
        "sess-A": { customTitle: 42, pinned: "yes", group: { bad: true } },
        "sess-B": { customTitle: "ok", pinned: true, group: "ok" },
      },
    }),
    "utf8",
  );
  const store = await createSessionConfigStore({ path: p, envDefault: false });
  assert.equal(store.getMetadata("sess-A"), undefined);
  assert.deepEqual(store.getMetadata("sess-B"), { customTitle: "ok", pinned: true, group: "ok" });
});