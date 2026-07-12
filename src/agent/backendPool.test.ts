import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createBackendPool, type BackendPool } from "./backendPool";
import { createAgentBackend } from "./index";
import type { AgentBackend } from "./types";

const FAKE_AGENT = path.resolve(process.cwd(), "test/fixtures/fake-streaming-agent.cjs");

function cfg(workspace: string) {
  return {
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: workspace,
  };
}

describe("BackendPool", () => {
  test("getDefaultBackend returns the seeded backend", async () => {
    const workspace = await import("node:fs/promises").then((m) =>
      m.mkdtemp(path.join(require("node:os").tmpdir(), "jb-pool-")),
    );
    let backend: AgentBackend | undefined;
    try {
      backend = await createAgentBackend("chat", cfg(workspace), { workspace });
      const pool = await createBackendPool(backend, workspace, createAgentBackend);
      assert.equal(pool.getDefaultBackend(), backend);
    } finally {
      if (backend) await backend.shutdown();
      await import("node:fs/promises").then((m) => m.rm(workspace, { recursive: true, force: true }));
    }
  });

  test("getOrCreate returns the same backend for the same resolved cwd", async () => {
    const workspace = await import("node:fs/promises").then((m) =>
      m.mkdtemp(path.join(require("node:os").tmpdir(), "jb-pool-")),
    );
    const other = await import("node:fs/promises").then((m) =>
      m.mkdtemp(path.join(require("node:os").tmpdir(), "jb-pool-")),
    );
    let pool: BackendPool | undefined;
    try {
      const backend = await createAgentBackend("chat", cfg(workspace), { workspace });
      pool = await createBackendPool(backend, workspace, createAgentBackend);
      // Same path → same backend
      const a = await pool.getOrCreate(workspace);
      const b = await pool.getOrCreate(workspace);
      assert.equal(a, b);
      // Different path → different backend
      const c = await pool.getOrCreate(other);
      assert.notEqual(c, a);
      // listBackends should now contain both
      assert.equal(pool.listBackends().length, 2);
    } finally {
      if (pool) {
        for (const b of pool.listBackends()) {
          await b.shutdown();
        }
      }
      await import("node:fs/promises").then((m) =>
        m.rm(workspace, { recursive: true, force: true }),
      );
      await import("node:fs/promises").then((m) =>
        m.rm(other, { recursive: true, force: true }),
      );
    }
  });

  test("listSessions returns empty array when no sessions exist", async () => {
    const workspace = await import("node:fs/promises").then((m) =>
      m.mkdtemp(path.join(require("node:os").tmpdir(), "jb-pool-")),
    );
    let backend: AgentBackend | undefined;
    try {
      backend = await createAgentBackend("chat", cfg(workspace), { workspace });
      const pool = await createBackendPool(backend, workspace, createAgentBackend);
      const sessions = await pool.listSessions();
      assert.deepEqual(sessions, []);
    } finally {
      if (backend) await backend.shutdown();
      await import("node:fs/promises").then((m) =>
        m.rm(workspace, { recursive: true, force: true }),
      );
    }
  });
});