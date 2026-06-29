// Done-when integration test: drive the full backend/session pipeline
// against a fake ACP agent.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { AcpAgentBackend, AcpAgentSession } from "./index";
import type { ChatPatch } from "../types";

const FAKE_AGENT = path.resolve(process.cwd(), "test/fixtures/fake-streaming-agent.cjs");

function newBackend(env: Record<string, string> = {}) {
  return AcpAgentBackend.spawn({
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
}

async function collectPatches(iter: AsyncIterable<ChatPatch>): Promise<ChatPatch[]> {
  const out: ChatPatch[] = [];
  for await (const p of iter) {
    out.push(p);
    if (p.type === "done") break;
  }
  return out;
}

describe("AcpAgentBackend — handshake & session lifecycle", () => {
  test("spawn → initialize → reports capabilities from handshake", async () => {
    const backend = await newBackend();
    try {
      assert.equal(backend.kind, "acp");
      assert.equal(backend.role, "chat");
      assert.equal(backend.capabilities.images, true);
      assert.equal(backend.capabilities.canFork, true);
      assert.equal(backend.capabilities.steer, true);
      assert.equal(backend.capabilities.cancel, true);
      assert.equal(backend.capabilities.toolApprovals, true);
      assert.equal(backend.capabilities.multipleSessions, true);
    } finally {
      await backend.shutdown();
    }
  });

  test("createSession returns a session with an id and parsed models", async () => {
    const backend = await newBackend();
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      assert.ok(session.id);
      const models = backend.getSessionModels?.(session.id);
      assert.ok(models);
      assert.equal(models!.available.length, 2);
      assert.equal(models!.current, "fake-model");
    } finally {
      await backend.shutdown();
    }
  });

  test("healthcheck returns ok after a successful session/list probe", async () => {
    const backend = await newBackend();
    try {
      const r = await backend.healthcheck();
      assert.equal(r.ok, true);
    } finally {
      await backend.shutdown();
    }
  });
});

describe("AcpAgentSession.sendMessage — streaming", () => {
  test("emits text-start, text-delta, tool-call-start + finalized + tool-return, usage", async () => {
    const backend = await newBackend({
      X_FAKE_AGENT_NEW_TEXT: '["Hello, ", "world."]',
      X_FAKE_AGENT_TOOL_CALL: JSON.stringify({
        toolCallId: "tc-1",
        title: "read_file",
        kind: "fs.read",
        rawInput: { path: "package.json" },
        output: { ok: true, content: '{"name":"jarvis-bridge"}' },
      }),
    });
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      const patches = await collectPatches(session.sendMessage("read package.json"));

      // First patch: text-start (first chunk's text rides on `content`)
      const textStart = patches.find((p) => p.type === "text-start");
      assert.ok(textStart, "should have a text-start patch");

      // Subsequent text delta
      const textDelta = patches.find((p) => p.type === "text-delta");
      assert.ok(textDelta, "should have a text-delta patch");

      // Tool call sequence
      const toolStart = patches.find((p) => p.type === "tool-call-start");
      assert.ok(toolStart, "should have a tool-call-start patch");

      const toolFinalized = patches.filter((p) => p.type === "tool-call-finalized");
      assert.equal(toolFinalized.length, 1, "tool-call-finalized should emit exactly once");

      const toolReturn = patches.find((p) => p.type === "tool-return");
      assert.ok(toolReturn, "should have a tool-return patch");

      // Final usage patch from session/prompt result
      const usage = patches.find((p) => p.type === "usage");
      assert.ok(usage, "should have a usage patch");
      if (usage?.type === "usage") {
        assert.ok(usage.usage.output_tokens > 0);
      }
    } finally {
      await backend.shutdown();
    }
  });

  // Regression for the "empty reply" bug: opencode acp nests the update
  // body under an `update` key and puts `sessionId` on the outer envelope.
  // If handleSessionUpdate reads the flat shape, every text-delta is
  // dropped silently and the client sees usage + done with no body.
  test("nested-shape session/update delivers text patches to the client", async () => {
    const backend = await newBackend({
      X_FAKE_AGENT_NEW_TEXT: JSON.stringify(["Hello", " world"]),
    });
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      const patches = await collectPatches(session.sendMessage("hi"));
      const textStarts = patches.filter((p) => p.type === "text-start");
      const textDeltas = patches.filter((p) => p.type === "text-delta");
      assert.equal(textStarts.length, 1, "expected one text-start patch");
      assert.ok(textDeltas.length >= 1, "expected at least one text-delta patch");
      // Concatenated deltas should reconstruct the full agent reply.
      const fullText = textStarts[0].content +
        textDeltas.map((p) => (p.type === "text-delta" ? p.delta : "")).join("");
      assert.equal(fullText, "Hello world");
    } finally {
      await backend.shutdown();
    }
  });
});

describe("AcpAgentSession.cancel", () => {
  test("cancel() sends a session/cancel notification without throwing", async () => {
    const backend = await newBackend();
    try {
      const session = await backend.createSession({ cwd: process.cwd() });
      // Should not throw even if no turn is active.
      await session.cancel();
      await session.cancel(); // idempotent
    } finally {
      await backend.shutdown();
    }
  });
});