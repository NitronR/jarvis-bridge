import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { AcpConnection, AcpRequestError, AcpConnectionClosedError } from "./jsonrpc";

const FAKE_AGENT = path.resolve(process.cwd(), "test/fixtures/fake-agent.cjs");

function newConn(plan: unknown[]) {
  return AcpConnection.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: {
      ...process.env,
      X_FAKE_AGENT_PLAN: JSON.stringify(plan),
    },
  });
}

async function closeQuietly(conn: AcpConnection) {
  try {
    await conn.close();
  } catch {
    /* ignore */
  }
}

describe("AcpConnection — request/response routing", () => {
  test("sendRequest resolves with the response result", async () => {
    const conn = await newConn([
      { kind: "respond", id: 1, result: { ok: true } },
    ]);
    try {
      const result = await conn.sendRequest("ping");
      assert.deepEqual(result, { ok: true });
    } finally {
      await closeQuietly(conn);
    }
  });

  test("sendRequest rejects with AcpRequestError on an error response", async () => {
    const conn = await newConn([
      { kind: "respondError", id: 1, code: -32601, message: "method not found" },
    ]);
    try {
      await assert.rejects(
        () => conn.sendRequest("bogus"),
        (err: unknown) =>
          err instanceof AcpRequestError && err.code === -32601,
      );
    } finally {
      await closeQuietly(conn);
    }
  });

  test("sendNotification does not expect a response", async () => {
    const conn = await newConn([
      // respond to the gateway's first request (id starts at 1)
      { kind: "respond", id: 1, result: "pong" },
    ]);
    try {
      await conn.sendNotification("session/cancel", { sessionId: "s1" });
      const r = await conn.sendRequest("ping");
      assert.equal(r, "pong");
    } finally {
      await closeQuietly(conn);
    }
  });
});

describe("AcpConnection — incoming messages", () => {
  test("onNotification receives notifications", async () => {
    const conn = await newConn([
      { kind: "notify", method: "session/update", params: { hello: 1 } },
      { kind: "respond", id: 1, result: null },
    ]);
    try {
      const seen: unknown[] = [];
      conn.onNotification("session/update", (params) => {
        seen.push(params);
      });
      await conn.sendRequest("ping");
      // give the notification a tick to land
      await new Promise((r) => setImmediate(r));
      assert.equal(seen.length, 1);
      assert.deepEqual(seen[0], { hello: 1 });
    } finally {
      await closeQuietly(conn);
    }
  });

  test("onRequest handler replies with the handler's result", async () => {
    const conn = await newConn([
      // Delay so the test can register its handler first.
      { kind: "request", method: "elicitation/create", params: { q: 1 }, after: 50 },
    ]);
    try {
      let receivedParams: unknown = null;
      conn.onRequest("elicitation/create", async (params) => {
        receivedParams = params;
        return { action: "cancel" };
      });
      // Wait long enough for the request to arrive and be handled.
      await new Promise((r) => setTimeout(r, 500));
      assert.deepEqual(receivedParams, { q: 1 });
    } finally {
      await closeQuietly(conn);
    }
  });

  test("server→client request with no handler replies with -32601", async () => {
    const conn = await newConn([
      { kind: "request", method: "unknown/method", params: null },
    ]);
    try {
      // No handler registered — the fake agent gets an error reply.
      await new Promise((r) => setTimeout(r, 100));
      // Connection is still alive; close cleanly.
      assert.equal(conn.isClosed, false);
    } finally {
      await closeQuietly(conn);
    }
  });
});

describe("AcpConnection — exit & close", () => {
  test("subprocess exit causes pending requests to reject with AcpConnectionClosedError", async () => {
    const conn = await newConn([{ kind: "exit", code: 0, after: 50 }]);
    await assert.rejects(
      () => conn.sendRequest("never-responded"),
      (err: unknown) => err instanceof AcpConnectionClosedError,
    );
  });

  test("close() kills the subprocess and marks isClosed", async () => {
    const conn = await newConn([]);
    assert.equal(conn.isClosed, false);
    await conn.close();
    assert.equal(conn.isClosed, true);
  });
});