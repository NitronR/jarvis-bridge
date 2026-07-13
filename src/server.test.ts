import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "./server";
import { FakeBackend } from "../test/fixtures/fakeBackend";
import { createToolRegistry } from "./tools";
import { createSessionConfigStore } from "./agent/sessionConfigStore";

async function mkWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-server-"));
}

async function withServer<T>(
  setup: (workspace: string) => Promise<{
    backend: FakeBackend;
    fn: (url: string) => Promise<T>;
  }>,
): Promise<T> {
  const ws = await mkWorkspace();
  try {
    const { backend, fn } = await setup(ws);
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
    const app = createServer({ workspace: ws, port: 0, registry: testRegistry, tools, sessionConfig });
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
