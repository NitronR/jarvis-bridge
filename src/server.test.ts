import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "./server";
import { FakeBackend } from "../test/fixtures/fakeBackend";
import { createBackendPool } from "./agent/backendPool";
import { createToolRegistry } from "./tools";

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
    const pool = await createBackendPool(backend, ws, async () => backend);
    const tools = createToolRegistry(ws);
    const app = createServer({
      workspace: ws,
      port: 0,
      chatBackend: backend,
      backendPool: pool,
      injectContext: false,
      injectContextMode: "paths",
      autoApprove: { default: false },
      tools,
    });
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
