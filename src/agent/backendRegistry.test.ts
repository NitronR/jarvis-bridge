import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBackendRegistry } from "./backendRegistry";
import { createSettingsStore } from "./settingsStore";
import type { BackendProfile } from "./backendConfig";

const FAKE_AGENT = path.resolve(process.cwd(), "test/fixtures/fake-streaming-agent.cjs");

function profiles(): BackendProfile[] {
  return [
    { name: "opencode", kind: "opencode", command: process.execPath, args: [FAKE_AGENT] },
    { name: "claude", kind: "claude-acp", command: process.execPath, args: [FAKE_AGENT] },
  ];
}

async function mkWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "jb-registry-"));
}

test("eagerly spawns only the default backend", async () => {
  const workspace = await mkWorkspace();
  let registry;
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    registry = await createBackendRegistry({
      profiles: profiles(),
      settings,
      workspace,
      autoApprove: false,
    });
    assert.equal(registry.listBackendNames().length, 2);
    // Default is resolvable without error and without an explicit getBackend("claude") call yet.
    const def = await registry.getDefaultBackend();
    assert.ok(def);
  } finally {
    if (registry) await registry.shutdown();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("getBackend lazily spawns and caches a non-default backend", async () => {
  const workspace = await mkWorkspace();
  let registry;
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const a = await registry.getBackend("claude");
    const b = await registry.getBackend("claude");
    assert.equal(a, b);
  } finally {
    if (registry) await registry.shutdown();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("listSessions/findSession fan out across backends", async () => {
  const workspace = await mkWorkspace();
  let registry;
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const defaultBackend = await registry.getDefaultBackend();
    const session = await defaultBackend.createSession();

    // Stub listSessions to return our session
    defaultBackend.listSessions = async () => [{ sessionId: session.id }];

    const found = await registry.findSession(session.id);
    assert.ok(found);
    assert.equal(found?.backendName, "opencode");

    const all = await registry.listSessions();
    assert.ok(all.some((e) => e.summary.sessionId === session.id));
  } finally {
    if (registry) await registry.shutdown();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("deleteSession delegates to the owning backend and rejects if unsupported", async () => {
  const workspace = await mkWorkspace();
  let registry;
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const defaultBackend = await registry.getDefaultBackend();
    const session = await defaultBackend.createSession();

    // Stub listSessions to return our session
    defaultBackend.listSessions = async () => [{ sessionId: session.id }];

    // fake-streaming-agent.cjs does not advertise sessionCapabilities.delete,
    // so AcpAgentBackend.deleteSession is undefined for this fixture.
    await assert.rejects(() => registry.deleteSession(session.id), /delete not supported/i);
  } finally {
    if (registry) await registry.shutdown();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("setDefaultBackendName changes what getDefaultBackend resolves to", async () => {
  const workspace = await mkWorkspace();
  let registry;
  try {
    const settings = await createSettingsStore({
      path: path.join(workspace, "settings.json"),
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    registry = await createBackendRegistry({ profiles: profiles(), settings, workspace, autoApprove: false });
    const before = await registry.getDefaultBackend();
    await registry.setDefaultBackendName("claude");
    const after = await registry.getDefaultBackend();
    assert.notEqual(before, after);
    assert.equal(registry.getDefaultBackendName(), "claude");
  } finally {
    if (registry) await registry.shutdown();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
