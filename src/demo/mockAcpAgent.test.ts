// Drives the scripted mock agent through the real AcpAgentBackend, exactly as
// demo mode does (same profile → subprocess → ACP → ChatPatch path).

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AcpAgentBackend } from "../agent/acp/index";
import type { AgentSession, ChatPatch } from "../agent/types";
import { createDemoBackendProfile, DEMO_BACKEND_KIND } from "./index";

type ElicitationPatch = Extract<ChatPatch, { type: "elicitation-request" }>;

const CONFIG = {
  timing: { responseDelayMs: 0, textChunkDelayMs: 0, toolCallDurationMs: 0 },
  scenarios: [
    {
      name: "Two turns",
      description: "text then tools",
      firstMessage: "Start Demo",
      responses: [
        { parts: [{ type: "text", text: "first reply" }] },
        {
          parts: [
            { type: "tool_call", name: "Read", kind: "read", input: { file: "a.ts" }, output: "contents" },
            { type: "tool_call", name: "Bash", status: "failed", error: "exit 1" },
            { type: "text", text: "second reply" },
          ],
        },
      ],
    },
    {
      name: "Question",
      firstMessage: "ask me",
      responses: [
        {
          parts: [
            { type: "text", text: "before" },
            {
              type: "tool_call",
              name: "AskUserQuestion",
              input: { questions: [{ question: "Which db?", header: "DB", options: [{ label: "pg" }, { label: "sqlite" }] }] },
            },
            { type: "text", text: "after" },
          ],
        },
      ],
    },
    {
      name: "Slow",
      firstMessage: "slow",
      responses: [
        { parts: [{ type: "tool_call", name: "Bash", durationMs: 30_000 }, { type: "text", text: "never" }] },
        { parts: [{ type: "text", text: "next after cancel" }] },
      ],
    },
  ],
};

let dir: string;
let configPath: string;
let backend: AcpAgentBackend;

function writeConfig(cfg: unknown): void {
  fs.writeFileSync(configPath, JSON.stringify(cfg), "utf8");
}

async function send(
  session: AgentSession,
  message: string,
  onPatch?: (p: ChatPatch) => void,
): Promise<ChatPatch[]> {
  const out: ChatPatch[] = [];
  for await (const p of session.sendMessage(message)) {
    out.push(p);
    onPatch?.(p);
    if ((p as { type: string }).type === "done") break;
  }
  return out;
}

function text(patches: ChatPatch[]): string {
  return patches
    .map((p) => (p.type === "text-start" ? p.content : p.type === "text-delta" ? p.delta : ""))
    .join("");
}

function errorMessage(patches: ChatPatch[]): string {
  const errors = patches.filter((p): p is Extract<ChatPatch, { type: "error" }> => p.type === "error");
  assert.equal(errors.length, 1, "expected exactly one error patch");
  return errors[0].message;
}

function answerWith(session: AgentSession, action: "accept" | "decline", content?: Record<string, unknown>) {
  return (p: ChatPatch) => {
    if (p.type === "elicitation-request") {
      setTimeout(() => assert.equal(session.resolveElicitation!(p.requestId, action, content), true), 10);
    }
  };
}

describe("demo mock ACP agent (via AcpAgentBackend)", () => {
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "jb-demo-agent-"));
    configPath = path.join(dir, "demo-config.json");
    writeConfig(CONFIG);
    const profile = createDemoBackendProfile({ configPath });
    backend = await AcpAgentBackend.spawn({
      kind: profile.kind,
      command: profile.command,
      args: profile.args,
      cwd: dir,
      env: { ...process.env, ...profile.env },
    });
  });

  after(async () => {
    await backend?.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("handshake: demo kind, healthy, no model needed", async () => {
    assert.equal(backend.kind, DEMO_BACKEND_KIND);
    assert.equal((await backend.healthcheck()).ok, true);
    assert.equal(backend.capabilities.sessionDelete, true);
  });

  test("the first message picks the scenario; later messages get the next responses in order", async () => {
    const session = await backend.createSession({ cwd: dir });
    const first = await send(session, "  start   DEMO ");
    assert.equal(text(first), "first reply");
    assert.equal(first.at(-1)?.type, "done" as never);

    // Content of follow-ups is irrelevant — it just advances the script.
    const second = await send(session, "start demo");
    const tools = second.filter((p) => p.type === "tool-call-start");
    assert.deepEqual(tools.map((p) => p.type === "tool-call-start" && p.toolName), ["Read", "Bash"]);
    assert.ok(second.some((p) => p.type === "tool-call-finalized" && JSON.stringify(p.args) === '{"file":"a.ts"}'));
    assert.ok(second.some((p) => p.type === "tool-return" && p.content === "contents"));
    assert.ok(second.some((p) => p.type === "tool-error" && p.content === "exit 1"));
    assert.equal(text(second), "second reply");

    const third = await send(session, "anything else");
    assert.match(text(third), /no more scripted responses/);
    assert.match(text(third), /Two turns/);
    assert.ok(!third.some((p) => p.type === "error"), "the end-of-script note is a normal reply");
  });

  test("after the end-of-script note, every later message is an error telling the user to start a new chat", async () => {
    const session = await backend.createSession({ cwd: dir });
    await send(session, "start demo");
    await send(session, "two");
    assert.match(text(await send(session, "three")), /no more scripted responses/);

    for (const msg of ["four", "start demo", "ask me"]) {
      const patches = await send(session, msg);
      assert.equal(text(patches), "", msg);
      const message = errorMessage(patches);
      assert.match(message, /^Demo mode: scenario "Two turns" has ended, so this chat has no more responses\. Start a new chat/, msg);
      for (const s of CONFIG.scenarios) assert.ok(message.includes(`"${s.firstMessage}"`), s.firstMessage);
      assert.ok(!message.includes("\n"), "the error box shows plain text on one line");
    }

    // The note stays in the history (it's a real reply); the failed turns don't.
    const reloaded = await backend.loadSession(session.id, { cwd: dir });
    const history = reloaded.consumeReplayHistory!();
    assert.deepEqual(
      history.filter((h) => h.kind === "user").map((h) => h.kind === "user" && h.content),
      ["start demo", "two", "three"],
    );
    assert.match(text((history.at(-1) as { patches: ChatPatch[] }).patches), /no more scripted responses/);
    // So the chat still reads as finished after a reload, and stays finished.
    assert.match(errorMessage(await send(reloaded, "five")), /has ended/);
  });

  test("an unmatched first message is an error listing the triggers", async () => {
    const session = await backend.createSession({ cwd: dir });
    const patches = await send(session, "what can you do?");
    assert.equal(text(patches), "", "no agent text, only the error");
    const message = errorMessage(patches);
    assert.match(message, /^Demo mode: no scenario matches "what can you do\?"\. Start a new chat/);
    for (const s of CONFIG.scenarios) assert.ok(message.includes(`"${s.firstMessage}" (${s.name})`), s.firstMessage);
    assert.ok(!message.includes("\n"), "the error box shows plain text on one line");
  });

  test("after an unmatched first message, no later message can start a scenario", async () => {
    const session = await backend.createSession({ cwd: dir });
    await send(session, "what can you do?");
    // Even an exact trigger is refused now — scenarios only start on a chat's first message.
    for (const msg of ["start demo", "ask me", "anything"]) {
      const patches = await send(session, msg);
      assert.equal(text(patches), "", msg);
      const message = errorMessage(patches);
      assert.match(message, /^Demo mode: this chat's first message didn't match a scenario, so it can't run one\. Start a new chat/, msg);
      for (const s of CONFIG.scenarios) assert.ok(message.includes(`"${s.firstMessage}"`), s.firstMessage);
      assert.ok(!patches.some((p) => p.type === "tool-call-start" || p.type === "elicitation-request"), msg);
    }
    // Failed turns leave nothing behind: no replay history, not listed.
    const history = (await backend.loadSession(session.id, { cwd: dir })).consumeReplayHistory!();
    assert.deepEqual(history, []);
    assert.ok(!(await backend.listSessions()).some((s) => s.sessionId === session.id));
    // A new chat can start the scenario as usual.
    const fresh = await backend.createSession({ cwd: dir });
    assert.equal(text(await send(fresh, "start demo")), "first reply");
  });

  test("reloading a chat whose first message matched nothing lets its next message start a scenario", async () => {
    const session = await backend.createSession({ cwd: dir });
    await send(session, "what can you do?");
    assert.match(errorMessage(await send(session, "start demo")), /can't run one/, "locked before the reload");

    // A reload (what /chat/init does for ?sessionId=…) shows the chat empty…
    const reloaded = await backend.loadSession(session.id, { cwd: dir });
    assert.deepEqual(reloaded.consumeReplayHistory!(), []);
    // …so its next message is the first one the user sees, and may match.
    assert.equal(text(await send(reloaded, "  START demo")), "first reply");
    assert.match(text(await send(reloaded, "go on")), /second reply/);
    const listed = (await backend.listSessions()).find((s) => s.sessionId === session.id);
    assert.equal(listed?.title, "START demo");

    // An unmatched message after the reload locks it again, just like a new chat.
    const other = await backend.createSession({ cwd: dir });
    await send(other, "nope");
    const again = await backend.loadSession(other.id, { cwd: dir });
    await send(again, "still nope");
    assert.match(errorMessage(await send(again, "start demo")), /can't run one/);
  });

  test("AskUserQuestion pops the question dialog and continues after submit", async () => {
    const session = await backend.createSession({ cwd: dir });
    const patches = await send(session, "ask me", answerWith(session, "accept", { question_0: "sqlite" }));
    const types = patches.map((p) => p.type);
    const elicitation = patches.find((p): p is ElicitationPatch => p.type === "elicitation-request");
    assert.ok(elicitation, "expected an elicitation-request");
    assert.equal(elicitation.message, "Which db?");
    assert.equal(elicitation.fields[0].kind, "select");
    assert.deepEqual(elicitation.fields[0].options?.map((o) => o.value), ["pg", "sqlite"]);
    const start = patches.find((p) => p.type === "tool-call-start");
    assert.equal(elicitation.toolCallId, start?.type === "tool-call-start" ? start.toolCallId : undefined);
    // before → tool → dialog → result → after, in that order.
    assert.ok(types.indexOf("elicitation-request") < types.indexOf("tool-return"));
    const ret = patches.find((p) => p.type === "tool-return");
    assert.deepEqual(ret?.type === "tool-return" && ret.content, { answers: { "Which db?": "sqlite" } });
    assert.equal(text(patches), "beforeafter");
    assert.ok(patches.findIndex((p) => p.type === "text-delta") > types.indexOf("tool-return"));
  });

  test("skipping the question also continues to the next part", async () => {
    const session = await backend.createSession({ cwd: dir });
    const patches = await send(session, "ask me", answerWith(session, "decline"));
    const ret = patches.find((p) => p.type === "tool-return");
    assert.equal(ret?.type === "tool-return" && ret.content, "User skipped the question.");
    assert.equal(text(patches), "beforeafter");
  });

  test("cancel stops the turn; the next message plays the next response", async () => {
    const session = await backend.createSession({ cwd: dir });
    const started = Date.now();
    const patches = await send(session, "slow", (p) => {
      if (p.type === "tool-call-start") void session.cancel();
    });
    assert.ok(Date.now() - started < 10_000, "cancel should not wait for the tool to finish");
    assert.ok(patches.some((p) => p.type === "tool-error" && p.content === "Cancelled"));
    assert.equal(text(patches), "");
    assert.equal(text(await send(session, "go on")), "next after cancel");
  });

  test("sessions are listed, replayed on load, and deletable", async () => {
    const session = await backend.createSession({ cwd: dir });
    await send(session, "start demo");
    const listed = (await backend.listSessions()).find((s) => s.sessionId === session.id);
    assert.equal(listed?.title, "start demo");
    assert.equal(listed?.cwd, dir);

    const loaded = await backend.loadSession(session.id, { cwd: dir });
    const history = loaded.consumeReplayHistory!();
    assert.equal(history[0].kind, "user");
    assert.equal(history[0].kind === "user" && history[0].content, "start demo");
    assert.equal(history[1].kind === "assistant" && text(history[1].patches), "first reply");
    // The scenario position survives a reload.
    assert.equal(text(await send(loaded, "more")), "second reply");

    await backend.deleteSession(session.id);
    await assert.rejects(backend.loadSession(session.id, { cwd: dir }), /Resource not found/);
  });

  test("config edits apply to the next new chat without a restart", async () => {
    try {
      writeConfig({
        ...CONFIG,
        scenarios: [{ name: "New", firstMessage: "fresh", responses: [{ parts: [{ type: "text", text: "reloaded" }] }] }],
      });
      const session = await backend.createSession({ cwd: dir });
      assert.equal(text(await send(session, "fresh")), "reloaded");

      fs.writeFileSync(configPath, "{ broken", "utf8");
      const broken = await backend.createSession({ cwd: dir });
      const patches = await send(broken, "fresh");
      assert.match(errorMessage(patches), /not valid JSON/);
      // A config error isn't a failed match: once fixed, the same chat can
      // still start a scenario with its next message.
      writeConfig(CONFIG);
      assert.equal(text(await send(broken, "start demo")), "first reply");
    } finally {
      writeConfig(CONFIG);
    }
  });
});
