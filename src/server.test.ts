import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "./server";
import { FakeBackend, FakeSession } from "../test/fixtures/fakeBackend";
import { createToolRegistry } from "./tools";
import { createSessionConfigStore } from "./agent/sessionConfigStore";
import { createBackendRegistry } from "./agent/backendRegistry";
import { createSettingsStore } from "./agent/settingsStore";
import type { BackendProfile } from "./agent/backendConfig";

const FAKE_AGENT = path.resolve(process.cwd(), "test/fixtures/fake-streaming-agent.cjs");

async function mkWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-server-"));
}

async function withServer<T>(
  setup: (workspace: string) => Promise<{
    backend: FakeBackend;
    fn: (url: string) => Promise<T>;
    pickFolder?: import("./pickFolder").PickFolderFn;
  }>,
): Promise<T> {
  const ws = await mkWorkspace();
  try {
    const { backend, fn, pickFolder } = await setup(ws);
    // Swap in the caller-supplied FakeBackend as the eagerly-spawned default's
    // pool's default backend, since createBackendRegistry would otherwise try
    // to spawn a real process. Simplest correct approach: bypass
    // createBackendRegistry's spawn path entirely for tests and build a
    // registry-shaped object directly around the one FakeBackend, matching
    // what createBackendRegistry exposes.
    const testRegistry = makeSingleBackendTestRegistry(backend);
    const tools = createToolRegistry(ws);
    const sessionConfig = await createSessionConfigStore({
      path: path.join(ws, "session_metadata.json"),
      envDefault: false,
    });
    const app = createServer({ workspace: ws, port: 0, registry: testRegistry, tools, sessionConfig, pickFolder });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      return await fn(url);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
}

function makeSingleBackendTestRegistry(backend: FakeBackend): import("./agent/backendRegistry").BackendRegistry {
  let defaultBackend = "fake";
  return {
    getDefaultBackendName: () => defaultBackend,
    setDefaultBackendName: async (name: string) => {
      if (name !== "fake" && name !== "other") {
        throw new Error(`unknown backend name: ${name}`);
      }
      defaultBackend = name;
    },
    listBackendNames: () => ["fake", "other"],
    getDefaultBackend: async () => backend,
    getBackend: async () => backend,
    listSessions: async () => {
      const sessions = await backend.listSessions();
      return sessions.map((summary) => ({ backend, backendName: "fake", cwd: "", summary }));
    },
    findSession: async (sessionId: string) => {
      const s = backend.getSession(sessionId);
      if (!s) return null;
      return { backend, backendName: "fake", cwd: "", summary: { sessionId } };
    },
    getSession: async (sessionId: string) => backend.getSession(sessionId),
    deleteSession: async (sessionId: string) => {
      const s = backend.getSession(sessionId);
      if (!s) throw new Error(`session not found: ${sessionId}`);
      if (!backend.deleteSession) throw new Error("delete not supported by backend: fake");
      await backend.deleteSession(sessionId);
    },
    shutdown: async () => {},
  };
}

test("GET /health returns ok", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    },
  }));
});

test("GET /chat/init returns a session id, capabilities, and slash commands", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend({
      slashCommands: [{ name: "review", description: "review code" }],
    }),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/init`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        sessionId: string;
        slashCommands: Array<{ name: string; description?: string }>;
        capabilities: { steer: boolean; canFork: boolean };
        backend: { kind: string; role: string };
      };
      assert.equal(body.ok, true);
      assert.ok(typeof body.sessionId === "string" && body.sessionId.length > 0);
      assert.equal(body.backend.kind, "fake");
      assert.equal(body.backend.role, "chat");
      assert.equal(body.capabilities.steer, true);
      assert.equal(body.capabilities.canFork, true);
      assert.deepEqual(body.slashCommands, [
        { name: "review", description: "review code" },
      ]);
    },
  }));
});

test("POST /chat/send streams SSE patches and ends with {type:'done'}", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      // First init a session.
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello", sessionId: initBody.sessionId }),
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
      const text = await res.text();
      const events = text.split("\n\n").filter((s) => s.startsWith("data: "));
      assert.ok(events.length >= 2, "expected ≥2 SSE events");
      const last = JSON.parse(events[events.length - 1].slice(6)) as {
        type: string;
      };
      assert.equal(last.type, "done");
      const first = JSON.parse(events[0].slice(6)) as {
        type: string;
        delta?: string;
      };
      assert.equal(first.type, "text-delta");
      assert.equal(first.delta, "hi from fake");
    },
  }));
});

test("disconnecting mid-stream does not cancel the turn", async () => {
  const sessionId = "sess-disconnect-1";
  const backend = new FakeBackend({
    initialSessionId: sessionId,
    initialSessionPatches: [
      { type: "text-delta", index: 0, delta: "a" },
      { type: "text-delta", index: 0, delta: "b" },
      { type: "text-delta", index: 0, delta: "c" },
      { type: "done" },
    ],
    patchDelayMs: 40,
  });
  await withServer(async (ws) => ({
    backend,
    fn: async (url) => {
      const controller = new AbortController();
      const sendPromise = fetch(`${url}/chat/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", sessionId }),
        signal: controller.signal,
      }).catch(() => null); // the client-side abort itself rejects this fetch
      await new Promise((r) => setTimeout(r, 20));
      controller.abort(); // simulate a page refresh mid-stream
      await sendPromise;
      // Give the still-running turn time to finish server-side.
      await new Promise((r) => setTimeout(r, 200));
      const session = backend.getSession(sessionId) as FakeSession;
      assert.equal(session.cancelled, 0, "disconnect must not call session.cancel()");
    },
  }));
});

test("GET /chat/stream replays buffered patches then continues live, and 404s once the turn is gone", async () => {
  const sessionId = "sess-reattach-1";
  await withServer(async (ws) => {
    const backend = new FakeBackend({
      initialSessionId: sessionId,
      initialSessionPatches: [
        { type: "text-delta", index: 0, delta: "a" },
        { type: "text-delta", index: 0, delta: "b" },
        { type: "text-delta", index: 0, delta: "c" },
        { type: "done" },
      ],
      patchDelayMs: 40,
    });
    return {
      backend,
      fn: async (url) => {
        // No active turn yet — 404.
        const before = await fetch(`${url}/chat/stream?sessionId=${sessionId}`);
        assert.equal(before.status, 404);

        // A sessionId that was never created — must hit the "session not
        // found" 404 branch, not the "no active turn" one.
        const unknownSession = await fetch(`${url}/chat/stream?sessionId=does-not-exist`);
        assert.equal(unknownSession.status, 404);

        // Start a turn but don't wait for it to finish.
        const sendPromise = fetch(`${url}/chat/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "hi", sessionId }),
        });
        await new Promise((r) => setTimeout(r, 60)); // let ~1 patch land

        const streamRes = await fetch(`${url}/chat/stream?sessionId=${sessionId}`);
        assert.equal(streamRes.status, 200);
        assert.match(streamRes.headers.get("content-type") ?? "", /text\/event-stream/);
        const text = await streamRes.text();
        const events = text.split("\n\n").filter((s) => s.startsWith("data: ")).map((s) => JSON.parse(s.slice(6)));
        assert.ok(events.length >= 2, "expected buffered + live patches");
        assert.equal(events[events.length - 1].type, "done");

        await sendPromise; // drain the original request too

        // Turn is over now — a fresh reattach 404s again.
        const after = await fetch(`${url}/chat/stream?sessionId=${sessionId}`);
        assert.equal(after.status, 404);
      },
    };
  });
});

test("GET /chat/init returns lastUsage=null when no turn has happened yet", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/init`);
      const body = (await res.json()) as { lastUsage: unknown };
      assert.equal(body.lastUsage, null);
    },
  }));
});

// Regression: the context-usage indicator needs the last known usage to
// survive a page reload. Claude's own session/load replay doesn't re-emit
// usage_update for past turns (see docs/acp-notes.md), so the gateway must
// cache it itself in sessionConfigStore and return it out-of-band on init,
// independent of what the agent chooses to replay.
test("POST /chat/send caches a usage patch, and GET /chat/init returns it as lastUsage on a later resume", async () => {
  const sessionId = "sess-usage-1";
  await withServer(async (ws) => ({
    backend: new FakeBackend({
      initialSessionId: sessionId,
      initialSessionPatches: [
        { type: "text-delta", index: 0, delta: "6" },
        {
          type: "usage",
          usage: {
            requests: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            context_limit: 1000000,
            context_used: 44042,
            cost: { amount: 0.13, currency: "USD" },
          },
        },
        { type: "done" },
      ],
    }),
    fn: async (url) => {
      const sendRes = await fetch(`${url}/chat/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "what is 3+3", sessionId }),
      });
      assert.equal(sendRes.status, 200);
      await sendRes.text(); // drain the SSE stream

      const initRes = await fetch(`${url}/chat/init?sessionId=${sessionId}`);
      const body = (await initRes.json()) as {
        lastUsage: { context_limit?: number; context_used?: number; cost?: { amount: number } } | null;
      };
      assert.ok(body.lastUsage, "lastUsage should be populated after a turn with a usage patch");
      assert.equal(body.lastUsage!.context_limit, 1000000);
      assert.equal(body.lastUsage!.context_used, 44042);
      assert.equal(body.lastUsage!.cost?.amount, 0.13);
    },
  }));
});

test("POST /chat/cancel resolves the cancel on the session", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: initBody.sessionId }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    },
  }));
});

test("POST /chat/approval forwards optionId to the session", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: initBody.sessionId,
          requestId: "appr-1",
          optionId: "allow_once",
        }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    },
  }));
});

test("POST /chat/elicitation forwards action/content to the session", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/elicitation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: initBody.sessionId,
          requestId: "elic-1",
          action: "accept",
          content: { question_0: "b" },
        }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    },
  }));
});

test("POST /tools/execute runs read_file and returns contents", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      await fs.writeFile(path.join(ws, "greet.txt"), "aloha", "utf8");
      const res = await fetch(`${url}/tools/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "read_file", params: { path: "greet.txt" } }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; result: string };
      assert.equal(body.ok, true);
      assert.equal(body.result, "aloha");
    },
  }));
});

test("POST /tools/execute 404 for unknown tool", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/tools/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "nope", params: {} }),
      });
      assert.equal(res.status, 404);
    },
  }));
});

test("GET /chat/sessions lists sessions", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend({
      listSessions: [
        {
          sessionId: "s1",
          title: "first",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/sessions`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        sessions: Array<{ sessionId: string }>;
      };
      assert.equal(body.sessions.length, 1);
      assert.equal(body.sessions[0].sessionId, "s1");
    },
  }));
});

test("POST /chat/sessions/fork returns a new session id", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/sessions/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: initBody.sessionId }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        sourceSessionId: string;
        sessionId: string;
      };
      assert.equal(body.ok, true);
      assert.equal(body.sourceSessionId, initBody.sessionId);
      assert.notEqual(body.sessionId, initBody.sessionId);
    },
  }));
});

test("PATCH /chat/sessions/:id stores customTitle metadata", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(
        `${url}/chat/sessions/${initBody.sessionId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ customTitle: "renamed" }),
        },
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        sessionId: string;
        metadata: { customTitle: string };
      };
      assert.equal(body.ok, true);
      assert.equal(body.metadata.customTitle, "renamed");
    },
  }));
});

test("GET /chat/init returns the stored customTitle after a rename (within same instance)", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string; customTitle?: string };
      assert.equal(initBody.customTitle, null, "fresh session has no customTitle");

      await fetch(`${url}/chat/sessions/${initBody.sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customTitle: "renamed" }),
      });

      const reloadRes = await fetch(`${url}/chat/init?sessionId=${initBody.sessionId}`);
      const reloadBody = (await reloadRes.json()) as { customTitle?: string };
      assert.equal(reloadBody.customTitle, "renamed");
    },
  }));
});

test("PATCH /chat/sessions/:id persists customTitle to disk", async () => {
  const ws = await mkWorkspace();
  const sessionConfigPath = path.join(ws, "session_metadata.json");
  try {
    const backend = new FakeBackend({
      initialSessionId: "sess-1",
      initialSessionPatches: [],
    });
    const testRegistry = makeSingleBackendTestRegistry(backend);
    const app = createServer({
      workspace: ws,
      port: 0,
      registry: testRegistry,
      tools: createToolRegistry(ws),
      sessionConfig: await createSessionConfigStore({ path: sessionConfigPath, envDefault: false }),
    });
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.on("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const url = `http://127.0.0.1:${addr.port}`;

      const patchRes = await fetch(`${url}/chat/sessions/sess-1`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customTitle: "disk-backed" }),
      });
      assert.equal(patchRes.status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const reopened = await createSessionConfigStore({ path: sessionConfigPath, envDefault: false });
    assert.deepEqual(reopened.getMetadata("sess-1"), { customTitle: "disk-backed" });
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("GET /chat/init returns stored customTitle across server restart (persistent metadata)", async () => {
  const ws = await mkWorkspace();
  const sessionConfigPath = path.join(ws, "session_metadata.json");
  try {
    // Pre-populate the store with a customTitle (simulating a previous session).
    const sessionConfig = await createSessionConfigStore({ path: sessionConfigPath, envDefault: false });
    await sessionConfig.setMetadata("sess-1", { customTitle: "carried over" });

    const backend = new FakeBackend({
      initialSessionId: "sess-1",
      initialSessionPatches: [],
    });
    const testRegistry = makeSingleBackendTestRegistry(backend);
    const app = createServer({
      workspace: ws,
      port: 0,
      registry: testRegistry,
      tools: createToolRegistry(ws),
      sessionConfig: await createSessionConfigStore({ path: sessionConfigPath, envDefault: false }),
    });
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.on("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const url = `http://127.0.0.1:${addr.port}`;

      const res = await fetch(`${url}/chat/init?sessionId=sess-1`);
      const body = (await res.json()) as { customTitle?: string };
      assert.equal(body.customTitle, "carried over");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("GET /chat/sessions includes persisted customTitle", async () => {
  const ws = await mkWorkspace();
  const sessionConfigPath = path.join(ws, "session_metadata.json");
  try {
    const sessionConfig = await createSessionConfigStore({ path: sessionConfigPath, envDefault: false });
    await sessionConfig.setMetadata("sess-1", { customTitle: "pinned title" });

    const backend = new FakeBackend({
      initialSessionId: "sess-1",
      initialSessionPatches: [],
    });
    backend.listSessions = async () => [{ sessionId: "sess-1", title: "generated" }];
    const testRegistry = makeSingleBackendTestRegistry(backend);
    const app = createServer({
      workspace: ws,
      port: 0,
      registry: testRegistry,
      tools: createToolRegistry(ws),
      sessionConfig: await createSessionConfigStore({ path: sessionConfigPath, envDefault: false }),
    });
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.on("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const url = `http://127.0.0.1:${addr.port}`;

      const res = await fetch(`${url}/chat/sessions`);
      const body = (await res.json()) as { sessions: Array<{ sessionId: string; customTitle?: string }> };
      assert.equal(body.sessions.length, 1);
      assert.equal(body.sessions[0].customTitle, "pinned title");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("GET /chat/model returns model info for the current session", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend({
      models: [
        { modelId: "m1", name: "Model One" },
        { modelId: "m2", name: "Model Two" },
      ],
    }),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/model?sessionId=${initBody.sessionId}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        supported: boolean;
        available: Array<{ modelId: string }>;
        current: string;
      };
      assert.equal(body.ok, true);
      assert.equal(body.supported, true);
      assert.equal(body.available.length, 2);
      assert.equal(body.current, "m1");
    },
  }));
});

test("GET /chat/usage returns 501 when the backend doesn't support it", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/usage?sessionId=${initBody.sessionId}`);
      assert.equal(res.status, 501);
    },
  }));
});

test("GET /chat/usage returns rate_limits from a backend that supports queryUsage", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend({
      queryUsage: async () => ({ five_hour: { status: "allowed_warning", utilization: 0.55 } }),
    }),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/usage?sessionId=${initBody.sessionId}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        rate_limits: { five_hour?: { status: string; utilization: number } } | null;
      };
      assert.equal(body.ok, true);
      assert.equal(body.rate_limits?.five_hour?.utilization, 0.55);
    },
  }));
});

test("GET /chat/usage returns 502 when queryUsage rejects", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend({
      queryUsage: async () => {
        throw new Error("claude ENOENT");
      },
    }),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };
      const res = await fetch(`${url}/chat/usage?sessionId=${initBody.sessionId}`);
      assert.equal(res.status, 502);
      const body = (await res.json()) as { error: string };
      assert.match(body.error, /ENOENT/);
    },
  }));
});

test("GET /chat/usage returns 404 for an unknown sessionId", async () => {
  await withServer(async () => ({
    backend: new FakeBackend({ queryUsage: async () => null }),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/usage?sessionId=nope`);
      assert.equal(res.status, 404);
    },
  }));
});

test("GET /chat/usage falls back to the persisted session cwd when findSession's cwd-based index misses the session", async () => {
  // Regression: findSession() locates a session's owner via each backend
  // instance's session/list filtered to its own spawn cwd (see
  // AcpAgentBackend.listSessions()). If the underlying agent's own record
  // of a session's cwd drifts from what Jarvis Bridge persisted at creation
  // time (e.g. the agent entered a git worktree mid-conversation via
  // EnterWorktree), findSession no longer finds it — even though the
  // session is otherwise perfectly resumable, since session/load looks a
  // session up by ID, not by cwd (see /chat/init). resolveSessionEntry must
  // fall back to the persisted cwd + default backend in that case, same as
  // /chat/init already does.
  const ws = await mkWorkspace();
  let server: import("node:http").Server | undefined;
  try {
    const backend = new FakeBackend({
      queryUsage: async () => ({ five_hour: { status: "allowed_warning", utilization: 0.4 } }),
    });
    const sessionConfig = await createSessionConfigStore({
      path: path.join(ws, "session_metadata.json"),
      envDefault: false,
    });
    const registry: import("./agent/backendRegistry").BackendRegistry = {
      getDefaultBackendName: () => "fake",
      setDefaultBackendName: async () => {},
      listBackendNames: () => ["fake"],
      getDefaultBackend: async () => backend,
      getBackend: async () => backend,
      listSessions: async () => [],
      // Simulates the cwd-index miss: the session exists on this backend,
      // but findSession's cwd-filtered lookup can no longer see it.
      findSession: async () => null,
      getSession: async (sessionId: string) => backend.getSession(sessionId),
      deleteSession: async () => {},
      shutdown: async () => {},
    };
    const tools = createToolRegistry(ws);
    const app = createServer({ workspace: ws, port: 0, registry, tools, sessionConfig });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.on("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}`;

    const created = await backend.createSession({ cwd: ws });
    await sessionConfig.setSessionCwd(created.id, ws);

    const res = await fetch(`${url}/chat/usage?sessionId=${created.id}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      rate_limits: { five_hour?: { utilization: number } } | null;
    };
    assert.equal(body.ok, true);
    assert.equal(body.rate_limits?.five_hour?.utilization, 0.4);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("POST /chat/auto-approve sets and clears the override", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const initRes = await fetch(`${url}/chat/init`);
      const initBody = (await initRes.json()) as { sessionId: string };

      const setRes = await fetch(`${url}/chat/auto-approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          sessionId: initBody.sessionId,
        }),
      });
      assert.equal(setRes.status, 200);
      const setBody = (await setRes.json()) as {
        ok: boolean;
        effective: boolean;
      };
      assert.equal(setBody.ok, true);
      assert.equal(setBody.effective, true);

      const clearRes = await fetch(`${url}/chat/auto-approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: null,
          sessionId: initBody.sessionId,
        }),
      });
      const clearBody = (await clearRes.json()) as {
        ok: boolean;
        effective: boolean;
        override: boolean | null;
      };
      assert.equal(clearBody.effective, false);
      assert.equal(clearBody.override, null);
    },
  }));
});

test("POST /chat/steer forwards the prompt to the session", async () => {
  let backend: FakeBackend;
  await withServer(async (ws) => {
    backend = new FakeBackend();
    return {
      backend,
      fn: async (url) => {
        const initRes = await fetch(`${url}/chat/init`);
        const initBody = (await initRes.json()) as { sessionId: string };
        const session = backend!.sessions.get(initBody.sessionId);
        assert.ok(session);
        session.steerHandler = async () => ({ accepted: true });
        const res = await fetch(`${url}/chat/steer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: "pivot",
            sessionId: initBody.sessionId,
          }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          ok: boolean;
          accepted: boolean;
        };
        assert.equal(body.accepted, true);
      },
    };
  });
});

test("GET /chat/init respects sessionId in query (resume)", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend({
      initialSessionId: "pinned-1",
      initialSessionPatches: [],
    }),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/init?sessionId=pinned-1`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { sessionId: string; resumed: boolean };
      assert.equal(body.sessionId, "pinned-1");
      assert.equal(body.resumed, true);
    },
  }));
});

test("GET /chat/init resuming a session created in a non-default cwd reloads it against that same cwd", async () => {
  await withServer(async (ws) => {
    const backend = new FakeBackend();
    return {
      backend,
      fn: async (url) => {
        const nonDefaultCwd = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-other-workspace-"));
        try {
          const createRes = await fetch(`${url}/chat/init?cwd=${encodeURIComponent(nonDefaultCwd)}`);
          assert.equal(createRes.status, 200);
          const created = (await createRes.json()) as { sessionId: string; cwd: string };
          assert.equal(created.cwd, nonDefaultCwd);
          assert.equal(backend.createdWithCwd.get(created.sessionId), nonDefaultCwd);

          // Simulate a plain page reload: only sessionId is sent, no cwd —
          // the browser strips the one-shot cwd param once it's consumed.
          const resumeRes = await fetch(`${url}/chat/init?sessionId=${encodeURIComponent(created.sessionId)}`);
          assert.equal(resumeRes.status, 200);
          const resumed = (await resumeRes.json()) as { sessionId: string; cwd: string; resumed: boolean };
          assert.equal(resumed.resumed, true);
          assert.equal(resumed.sessionId, created.sessionId);
          assert.equal(resumed.cwd, nonDefaultCwd);
          const lastLoad = backend.loadedWithCwd.at(-1);
          assert.equal(lastLoad?.sessionId, created.sessionId);
          assert.equal(lastLoad?.cwd, nonDefaultCwd);
        } finally {
          await fs.rm(nonDefaultCwd, { recursive: true, force: true });
        }
      },
    };
  });
});

test("GET /chat/auto-approve default effective=false", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/auto-approve`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        default: boolean;
        effective: boolean;
      };
      assert.equal(body.ok, true);
      assert.equal(body.default, false);
      assert.equal(body.effective, false);
    },
  }));
});

test("GET / serves the React-built index.html", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      const html = await res.text();
      assert.match(html, /<div id="root">/);
      assert.match(html, /\/assets\//);
    },
  }));
});

test("GET /assets/index-*.js serves the React bundle", async () => {
  await withServer(async (ws) => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const html = await (await fetch(`${url}/`)).text();
      const m = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
      assert.ok(m, "index.html should reference /assets/index-*.js");
      const res = await fetch(`${url}/assets/${m[1]}`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.length > 100, "bundle should have content");
    },
  }));
});

test("DELETE /chat/sessions/:id calls backend.deleteSession and returns ok", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const created = (await fetch(`${url}/chat/init`).then((r) => r.json())) as { sessionId: string };
      const res = await fetch(`${url}/chat/sessions/${created.sessionId}`, { method: "DELETE" });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    },
  }));
});

test("DELETE /chat/sessions/:id returns 404 for an unknown session", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/chat/sessions/does-not-exist`, { method: "DELETE" });
      assert.equal(res.status, 404);
    },
  }));
});

test("DELETE /chat/sessions/:id returns 501 if backend doesn't support session deletion", async () => {
  await withServer(async () => {
    const backend = new FakeBackend();
    backend.deleteSession = undefined as any;
    return {
      backend,
      fn: async (url) => {
        const created = (await fetch(`${url}/chat/init`).then((r) => r.json())) as { sessionId: string };
        const res = await fetch(`${url}/chat/sessions/${created.sessionId}`, { method: "DELETE" });
        assert.equal(res.status, 501);
      },
    };
  });
});

test("GET /settings/default-backend returns the available names and current default", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/settings/default-backend`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; available: string[]; default: string };
      assert.equal(body.ok, true);
      assert.deepEqual(body.available, ["fake", "other"]);
      assert.equal(body.default, "fake");
    },
  }));
});

test("PUT /settings/default-backend rejects an unknown name", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/settings/default-backend`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "nonexistent" }),
      });
      assert.equal(res.status, 400);
    },
  }));
});

test("PUT /settings/default-backend updates the default backend name", async () => {
  await withServer(async () => ({
    backend: new FakeBackend(),
    fn: async (url) => {
      const res = await fetch(`${url}/settings/default-backend`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "other" }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; default: string };
      assert.equal(body.ok, true);
      assert.equal(body.default, "other");

      const getRes = await fetch(`${url}/settings/default-backend`);
      assert.equal(getRes.status, 200);
      const getBody = (await getRes.json()) as { ok: boolean; default: string };
      assert.equal(getBody.default, "other");
    },
  }));
});

test("GET /chat/init?sessionId=X reloads on the backend that owns the session, not the current default", async () => {
  // Regression: when the user changes the default backend and then refreshes
  // a session tab, /chat/init must load the session against the backend
  // that originally created it — otherwise the new default's loadSession
  // call fails with "session not found" / 500, and the chat never loads.
  // The bug fires specifically when the owning backend's pool was never
  // spawned in this process (typical "gateway restarted with a different
  // default than the one that originally created the session" flow):
  // BackendRegistry.findSession() / listSessions() used to skip pools that
  // hadn't been spawned yet, so the session became invisible to the lookup
  // and the server fell back to the new default's loadSession, which then
  // failed. The fix: findSession/listSessions/getSession now lazy-spawn
  // every known profile's pool and consult its listSessions, so the
  // owning backend is always reachable.
  //
  // This test simulates the post-restart state with a fresh registry whose
  // envDefault differs from the session's owning backend, so the owning
  // pool is genuinely not in memory when findSession runs. The fake
  // streaming agent reads its advertised session list from the
  // X_FAKE_AGENT_SESSION_LIST env var at startup — we use that to make
  // the freshly-spawned "opencode" subprocess report the session we
  // created in the first phase, mirroring how a real agent CLI persists
  // sessions to its own storage across process restarts.
  const ws = await mkWorkspace();
  let registry1: import("./agent/backendRegistry").BackendRegistry | undefined;
  let registry2: import("./agent/backendRegistry").BackendRegistry | undefined;
  try {
    const settingsPath = path.join(ws, "settings.json");
    // Phase 1: a registry starts with default=opencode, creates a session
    // on opencode, then the user switches default to claude and the process
    // is restarted. We use a shared settings file so the second registry
    // boots with default=claude.
    const settings1 = await createSettingsStore({
      path: settingsPath,
      envDefault: "opencode",
      validNames: ["opencode", "claude"],
    });
    const profiles: BackendProfile[] = [
      { name: "opencode", kind: "opencode", command: process.execPath, args: [FAKE_AGENT] },
      { name: "claude", kind: "claude-acp", command: process.execPath, args: [FAKE_AGENT] },
    ];
    registry1 = await createBackendRegistry({ profiles, settings: settings1, workspace: ws, autoApprove: false });
    const opencodeBackend = await registry1.getDefaultBackend();
    const created = await opencodeBackend.createSession({ cwd: ws });
    const sid = created.id;
    await registry1.setDefaultBackendName("claude");
    await registry1.shutdown();
    registry1 = undefined;

    // Phase 2: a fresh registry boots with the persisted default=claude.
    // Only claude's pool is spawned eagerly. The opencode pool — the one
    // that owns `sid` — is un-spawned. The next time the opencode agent
    // subprocess starts, it must report `sid` in its session/list so
    // findSession can find it. We pre-seed that via the env-var contract
    // fake-streaming-agent.cjs uses, scoped to the opencode profile only
    // (not the global process env, so the claude subprocess still reports
    // an empty list and can't be mistaken for the owner).
    const phase2Profiles: BackendProfile[] = [
      {
        name: "opencode",
        kind: "opencode",
        command: process.execPath,
        args: [FAKE_AGENT],
        env: {
          X_FAKE_AGENT_SESSION_LIST: JSON.stringify([
            { sessionId: sid, cwd: ws, title: "t", updatedAt: new Date().toISOString() },
          ]),
        },
      },
      { name: "claude", kind: "claude-acp", command: process.execPath, args: [FAKE_AGENT] },
    ];
    const settings2 = await createSettingsStore({
      path: settingsPath,
      envDefault: "claude",
      validNames: ["opencode", "claude"],
    });
    registry2 = await createBackendRegistry({ profiles: phase2Profiles, settings: settings2, workspace: ws, autoApprove: false });

    const found = await registry2.findSession(sid);
    assert.ok(found, "findSession must discover a session on a non-default backend whose pool is un-spawned in this registry");
    assert.equal(found?.backendName, "opencode");
  } finally {
    if (registry1) await registry1.shutdown();
    if (registry2) await registry2.shutdown();
    await fs.rm(ws, { recursive: true, force: true });
  }
});

function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  return fn().finally(() => Object.defineProperty(process, "platform", original));
}

test("POST /chat/pick-folder returns 501 on non-darwin platforms without invoking pickFolder", async () => {
  await withPlatform("linux", async () => {
    let called = false;
    await withServer(async () => ({
      backend: new FakeBackend(),
      pickFolder: async () => {
        called = true;
        return { cancelled: false, cwd: "/should-not-be-used" };
      },
      fn: async (url) => {
        const res = await fetch(`${url}/chat/pick-folder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 501);
        const body = (await res.json()) as { ok: boolean; error: string };
        assert.equal(body.ok, false);
        assert.match(body.error, /not supported on this platform/);
      },
    }));
    assert.equal(called, false);
  });
});

test("POST /chat/pick-folder invokes the injected pickFolder and returns its result on darwin", async () => {
  await withPlatform("darwin", async () => {
    let receivedInitialCwd: string | undefined;
    await withServer(async (ws) => ({
      backend: new FakeBackend(),
      pickFolder: async (initialCwd) => {
        receivedInitialCwd = initialCwd;
        return { cancelled: false, cwd: "/Users/bob/chosen" };
      },
      fn: async (url) => {
        const res = await fetch(`${url}/chat/pick-folder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initialCwd: ws }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { ok: boolean; cancelled: boolean; cwd: string | null };
        assert.equal(body.ok, true);
        assert.equal(body.cancelled, false);
        assert.equal(body.cwd, "/Users/bob/chosen");
        assert.equal(receivedInitialCwd, ws);
      },
    }));
  });
});

test("GET /chat/init returns activeTurn:true and skips loadSession while a turn is streaming", async () => {
  const sessionId = "sess-init-active-1";
  await withServer(async (ws) => {
    const backend = new FakeBackend({
      initialSessionId: sessionId,
      initialSessionPatches: [
        { type: "text-delta", index: 0, delta: "a" },
        { type: "text-delta", index: 0, delta: "b" },
        { type: "text-delta", index: 0, delta: "c" },
        { type: "done" },
      ],
      patchDelayMs: 40,
    });
    return {
      backend,
      fn: async (url) => {
        const sendPromise = fetch(`${url}/chat/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "hi", sessionId }),
        });
        await new Promise((r) => setTimeout(r, 60)); // let ~1 patch land

        const initRes = await fetch(`${url}/chat/init?sessionId=${sessionId}`);
        assert.equal(initRes.status, 200);
        const body = (await initRes.json()) as {
          activeTurn: boolean;
          history: Array<{ kind: string; patches?: unknown[] }>;
        };
        assert.equal(body.activeTurn, true);
        const last = body.history[body.history.length - 1];
        assert.equal(last?.kind, "assistant");
        assert.ok((last?.patches?.length ?? 0) >= 1, "in-progress patches should be in history");
        assert.equal(backend.loadedWithCwd.length, 0, "loadSession must not be called while a turn is live");

        const sendRes = await sendPromise;
        await sendRes.text(); // consume the response body to ensure full completion
        await new Promise((r) => setTimeout(r, 50)); // ensure async generator cleanup completes

        const initAfter = await fetch(`${url}/chat/init?sessionId=${sessionId}`);
        const bodyAfter = (await initAfter.json()) as { activeTurn: boolean };
        assert.equal(bodyAfter.activeTurn, false);
        assert.equal(backend.loadedWithCwd.length, 1, "once the turn is over, init falls back to the normal loadSession path");
      },
    };
  });
});

test("POST /chat/pick-folder returns cancelled=true when the user cancels the dialog", async () => {
  await withPlatform("darwin", async () => {
    await withServer(async () => ({
      backend: new FakeBackend(),
      pickFolder: async () => ({ cancelled: true, cwd: null }),
      fn: async (url) => {
        const res = await fetch(`${url}/chat/pick-folder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { ok: boolean; cancelled: boolean; cwd: string | null };
        assert.equal(body.ok, true);
        assert.equal(body.cancelled, true);
        assert.equal(body.cwd, null);
      },
    }));
  });
});
