// Done-when integration test: drive the full backend/session pipeline
// against a fake ACP agent.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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

describe("AcpAgentBackend.listSessions — cwd scoping", () => {
  // Live-probe regression (docs/agent-claude-code.md): the real Claude adapter's
  // session/list returns the user's entire global session history across every
  // project, not scoped to this backend's workspace. listSessions() must filter
  // to sessions reporting this backend's own cwd (or no cwd at all, for agents
  // like opencode that don't report one and already scope server-side).
  test("filters out sessions reporting a different cwd", async () => {
    const backend = await newBackend({
      X_FAKE_AGENT_SESSION_LIST: JSON.stringify([
        { sessionId: "s-here", cwd: process.cwd(), title: "in this workspace" },
        { sessionId: "s-elsewhere", cwd: "/some/other/project", title: "unrelated project" },
        { sessionId: "s-no-cwd", title: "agent that doesn't report cwd" },
      ]),
    });
    try {
      const sessions = await backend.listSessions();
      const ids = sessions.map((s) => s.sessionId).sort();
      assert.deepEqual(ids, ["s-here", "s-no-cwd"]);
    } finally {
      await backend.shutdown();
    }
  });
});

describe("AcpAgentBackend — auto-approve permission selection", () => {
  // Live-probe regression (docs/agent-claude-code.md): the real Claude adapter's
  // "allow once" option has optionId "allow" with kind "allow_once" — optionId and
  // kind are distinct, agent-defined vocabularies. Auto-approve must select by
  // kind, not assume optionId is always the literal string "allow_once".
  test("selects the option by kind=allow_once, not a hardcoded optionId", async () => {
    const resultFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "jb-perm-")),
      "result.json",
    );
    const backend = await newBackend({
      X_FAKE_AGENT_PERMISSION_OPTIONS: JSON.stringify([
        { optionId: "allow_always", kind: "allow_always", name: "Always Allow" },
        { optionId: "allow", kind: "allow_once", name: "Allow" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ]),
      X_FAKE_AGENT_PERMISSION_RESULT_FILE: resultFile,
    });
    try {
      backend.setDefaultAutoApprove(true);
      const session = await backend.createSession({ cwd: process.cwd() });
      await collectPatches(session.sendMessage("do something"));
      const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
      assert.equal(result.outcome.outcome, "selected");
      assert.equal(result.outcome.optionId, "allow");
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

describe("AcpAgentBackend.deleteSession", () => {
  test("sessionDelete capability is false when the agent does not advertise sessionCapabilities.delete", async () => {
    const backend = await newBackend();
    try {
      assert.equal(backend.capabilities.sessionDelete, false);
      const session = await backend.createSession();
      await assert.rejects(() => backend.deleteSession(session.id), /delete not supported/i);
    } finally {
      await backend.shutdown();
    }
  });

  test("sessionDelete capability is true and deleteSession calls session/delete when advertised", async () => {
    const backend = await newBackend({ X_FAKE_AGENT_SESSION_DELETE: "true" });
    try {
      assert.equal(backend.capabilities.sessionDelete, true);
      const session = await backend.createSession();
      await backend.deleteSession(session.id);
    } finally {
      await backend.shutdown();
    }
  });

  // Live-probe regression (docs/agent-claude-code.md): the real Claude adapter
  // returns a generic top-level "Internal error" message for a not-found delete,
  // with the useful "not found" detail nested under error.data.details. server.ts's
  // DELETE route classifies 404 vs 500 by matching /not found/i against the thrown
  // error's message, so that detail must be folded into the message, not dropped.
  test("folds error.data.details into the thrown message (Claude's error shape)", async () => {
    const backend = await newBackend({
      X_FAKE_AGENT_SESSION_DELETE: "true",
      X_FAKE_AGENT_SESSION_DELETE_ERROR: JSON.stringify({
        code: -32603,
        message: "Internal error",
        data: { details: "Session abc123 not found in any project directory" },
      }),
    });
    try {
      const session = await backend.createSession();
      await assert.rejects(() => backend.deleteSession(session.id), /not found/i);
    } finally {
      await backend.shutdown();
    }
  });
});

describe("AcpAgentSession - promptQueueing / busy-gate", () => {
  test("busy gate rejects a second sendMessage when promptQueueing is not advertised", async () => {
    const backend = await AcpAgentBackend.spawn({
      command: process.execPath,
      args: [FAKE_AGENT],
      cwd: process.cwd(),
      env: { ...process.env, X_FAKE_AGENT_DELAY_MS: "200" },
    });
    try {
      const session = await backend.createSession();
      const first = session.sendMessage("first");
      const firstIter = first[Symbol.asyncIterator]();
      await firstIter.next(); // start draining, session becomes busy

      const secondPatches: unknown[] = [];
      for await (const p of session.sendMessage("second")) secondPatches.push(p);
      assert.deepEqual(secondPatches, [{ type: "error", message: "session is busy" }]);

      // Drain the first turn to completion so the process can shut down cleanly.
      for await (const _p of { [Symbol.asyncIterator]: () => firstIter }) { /* drain */ }
    } finally {
      await backend.shutdown();
    }
  });

  test("promptQueueing capability is true when the agent advertises _meta.claudeCode.promptQueueing", async () => {
    const backend = await AcpAgentBackend.spawn({
      command: process.execPath,
      args: [FAKE_AGENT],
      cwd: process.cwd(),
      env: { ...process.env, X_FAKE_AGENT_PROMPT_QUEUEING: "true" },
    });
    try {
      assert.equal(backend.capabilities.promptQueueing, true);
    } finally {
      await backend.shutdown();
    }
  });

  test("a queued sendMessage drains in FIFO order when promptQueueing is advertised", async () => {
    const backend = await AcpAgentBackend.spawn({
      command: process.execPath,
      args: [FAKE_AGENT],
      cwd: process.cwd(),
      env: {
        ...process.env,
        X_FAKE_AGENT_PROMPT_QUEUEING: "true",
        X_FAKE_AGENT_DELAY_MS: "100",
      },
    });
    try {
      const session = await backend.createSession();
      const order: string[] = [];
      const firstDone = (async () => {
        for await (const p of session.sendMessage("first")) {
          if ((p as { type?: string }).type === "done") order.push("first-done");
        }
      })();
      // Give the first call a moment to actually start (become busy) before queuing the second.
      await new Promise((r) => setTimeout(r, 20));
      const secondDone = (async () => {
        for await (const p of session.sendMessage("second")) {
          if ((p as { type?: string }).type === "done") order.push("second-done");
        }
      })();
      await Promise.all([firstDone, secondDone]);
      assert.deepEqual(order, ["first-done", "second-done"]);
    } finally {
      await backend.shutdown();
    }
  });

  test("createSession captures modes and non-model configOptions without dropping them", async () => {
    const backend = await AcpAgentBackend.spawn({
      command: process.execPath,
      args: [FAKE_AGENT],
      cwd: process.cwd(),
      env: { ...process.env, X_FAKE_AGENT_CLAUDE_STYLE_CONFIG: "true" },
    });
    try {
      const session = await backend.createSession();
      // Existing model-parsing contract still works:
      const models = backend.getSessionModels(session.id);
      assert.equal(models?.current, "claude-fake");
      assert.equal(models?.available.length, 1);
      // New: raw configOptions/modes are captured on the internal context
      // (exposed here via a package-private accessor added for this test).
      const raw = backend.getSessionRawConfig(session.id);
      assert.equal(raw?.modes?.currentModeId, "default");
      assert.equal(raw?.rawConfigOptions?.find((o) => o.id === "effort")?.currentValue, "medium");
    } finally {
      await backend.shutdown();
    }
  });
});