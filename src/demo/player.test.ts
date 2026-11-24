import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { elicitationSchemaToFields } from "../agent/acp/mapping";
import { DEFAULT_TIMING, type DemoResponse, type DemoTiming } from "./config";
import {
  buildQuestionElicitation,
  chunkText,
  PlaybackCancelledError,
  playResponse,
  summarizeAnswers,
  type AcpUpdateBody,
} from "./player";

const INSTANT: DemoTiming = { responseDelayMs: 0, textChunkDelayMs: 0, toolCallDurationMs: 0 };

function recorder(answer: (method: string, params: Record<string, unknown>) => Promise<unknown> = async () => ({})) {
  const updates: AcpUpdateBody[] = [];
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  let n = 0;
  return {
    updates,
    requests,
    opts: (signal: AbortSignal = new AbortController().signal, timing: DemoTiming = INSTANT) => ({
      io: {
        sendUpdate: (u: AcpUpdateBody) => updates.push(u),
        request: (method: string, params: Record<string, unknown>) => {
          requests.push({ method, params });
          return answer(method, params);
        },
      },
      timing,
      signal,
      newToolCallId: () => `tc-${++n}`,
    }),
  };
}

describe("chunkText", () => {
  test("chunks concatenate back to the exact text", () => {
    for (const text of ["", "one", "  leading and trailing  ", "a b c d e f g", "line\n\n```ts\ncode();\n```\n"]) {
      assert.equal(chunkText(text).join(""), text);
    }
    assert.deepEqual(chunkText("a b c d"), ["a b c ", "d"]);
  });
});

describe("playResponse", () => {
  test("text parts stream as agent_message_chunk, back-to-back parts separated by a blank line", async () => {
    const rec = recorder();
    const response: DemoResponse = { parts: [{ type: "text", text: "one two three four" }, { type: "text", text: "five" }] };
    await playResponse(response, rec.opts(undefined, { ...INSTANT, textChunkDelayMs: 1 }));
    assert.ok(rec.updates.every((u) => u.sessionUpdate === "agent_message_chunk"));
    const text = rec.updates.map((u) => (u.content as { text: string }).text).join("");
    assert.equal(text, "one two three four\n\nfive");
    assert.ok(rec.updates.length > 2, "expected the text to be chunked");
  });

  test("with textChunkDelayMs 0 each text part is a single chunk", async () => {
    const rec = recorder();
    await playResponse({ parts: [{ type: "text", text: "one two three four five" }] }, rec.opts());
    assert.equal(rec.updates.length, 1);
  });

  test("a tool call is announced with its input, then completes with its output", async () => {
    const rec = recorder();
    await playResponse(
      {
        parts: [
          { type: "tool_call", name: "Read", title: "Read a.ts", kind: "read", input: { file: "a.ts" }, output: "contents" },
          { type: "text", text: "done" },
        ],
      },
      rec.opts(),
    );
    assert.deepEqual(rec.updates, [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Read a.ts",
        kind: "read",
        status: "pending",
        rawInput: { file: "a.ts" },
        _meta: { demo: { toolName: "Read" } },
      },
      { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "in_progress" },
      { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "completed", rawOutput: "contents" },
      // No blank-line prefix: the previous part was a tool call, not text.
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
    ]);
  });

  test("title defaults to the tool name; a failed tool reports its error text", async () => {
    const rec = recorder();
    await playResponse({ parts: [{ type: "tool_call", name: "Bash", status: "failed", error: "exit 1" }] }, rec.opts());
    assert.equal(rec.updates[0].title, "Bash");
    assert.equal(rec.updates[0].kind, "other");
    assert.deepEqual(rec.updates.at(-1), {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "failed",
      content: [{ type: "text", text: "exit 1" }],
    });
  });

  test("an ask-user tool sends a form elicitation, waits for the answer, then continues", async () => {
    let answered = false;
    const rec = recorder(async () => {
      await new Promise((r) => setTimeout(r, 20));
      answered = true;
      return { action: "accept", content: { question_0: "B" } };
    });
    const questions = [{ question: "Pick one", options: [{ label: "A" }, { label: "B" }] }];
    await playResponse(
      { parts: [{ type: "tool_call", name: "AskUserQuestion", input: { questions } }, { type: "text", text: "after" }] },
      rec.opts(),
    );
    assert.equal(answered, true);
    assert.equal(rec.requests.length, 1);
    assert.equal(rec.requests[0].method, "elicitation/create");
    assert.equal(rec.requests[0].params.mode, "form");
    assert.equal(rec.requests[0].params.toolCallId, "tc-1");
    assert.equal(rec.requests[0].params.message, "Pick one");
    assert.deepEqual(
      rec.updates.map((u) => u.sessionUpdate),
      ["tool_call", "tool_call_update", "agent_message_chunk"],
    );
    assert.deepEqual(rec.updates[1], {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "completed",
      rawOutput: { answers: { "Pick one": "B" } },
    });
  });

  test("a skipped question still continues to the next part", async () => {
    const rec = recorder(async () => ({ action: "decline" }));
    await playResponse(
      {
        parts: [
          { type: "tool_call", name: "request_user_input", input: { questions: [{ question: "Name?" }] } },
          { type: "text", text: "after" },
        ],
      },
      rec.opts(),
    );
    assert.equal(rec.updates[1].rawOutput, "User skipped the question.");
    assert.equal(rec.updates.at(-1)?.sessionUpdate, "agent_message_chunk");
  });

  test("cancelling mid tool call marks it failed and stops playback", async () => {
    const rec = recorder();
    const ac = new AbortController();
    const p = playResponse(
      { parts: [{ type: "tool_call", name: "Bash", durationMs: 10_000 }, { type: "text", text: "never" }] },
      rec.opts(ac.signal, DEFAULT_TIMING),
    );
    setTimeout(() => ac.abort(), DEFAULT_TIMING.responseDelayMs + 50);
    await assert.rejects(p, PlaybackCancelledError);
    assert.deepEqual(rec.updates.at(-1), {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "failed",
      content: [{ type: "text", text: "Cancelled" }],
    });
    assert.ok(!rec.updates.some((u) => u.sessionUpdate === "agent_message_chunk"));
  });

  test("cancelling while the question dialog is open stops without waiting for an answer", async () => {
    const rec = recorder(() => new Promise(() => {}));
    const ac = new AbortController();
    const p = playResponse(
      { parts: [{ type: "tool_call", name: "AskUserQuestion", input: { questions: [{ question: "q?" }] } }] },
      rec.opts(ac.signal),
    );
    setTimeout(() => ac.abort(), 20);
    await assert.rejects(p, PlaybackCancelledError);
    assert.equal(rec.updates.at(-1)?.status, "failed");
  });
});

describe("question elicitation schema", () => {
  test("maps onto the gateway's select / multi-select / text fields", () => {
    const { message, requestedSchema } = buildQuestionElicitation([
      { question: "Which db?", header: "DB", options: [{ label: "pg", description: "Postgres" }, { label: "sqlite" }] },
      { question: "Which features?", header: "Features", options: [{ label: "a" }, { label: "b" }], multiSelect: true },
      { question: "Service name?" },
    ]);
    assert.equal(message, "Please answer the following questions");
    const fields = elicitationSchemaToFields(requestedSchema);
    assert.deepEqual(
      fields.map((f) => [f.key, f.kind, f.title, f.description, f.options?.map((o) => o.value)]),
      [
        ["question_0", "select", "DB", "Which db?", ["pg", "sqlite"]],
        ["question_0_custom", "text", "Other", "Type your own answer", undefined],
        ["question_1", "multi-select", "Features", "Which features?", ["a", "b"]],
        ["question_1_custom", "text", "Other", "Type your own answer", undefined],
        ["question_2", "text", undefined, "Service name?", undefined],
      ],
    );
    assert.equal(fields[0].options?.[0].description, "Postgres");
  });

  test("a single question becomes the dialog message", () => {
    const { message, requestedSchema } = buildQuestionElicitation([{ question: "Which db?", header: "DB", options: [{ label: "pg" }] }]);
    assert.equal(message, "Which db?");
    assert.equal(requestedSchema.properties.question_0.description, undefined);
  });

  test("summarizeAnswers combines picks and custom text per question", () => {
    const questions = [
      { question: "One?", options: [{ label: "a" }] },
      { question: "Many?", options: [{ label: "x" }, { label: "y" }], multiSelect: true },
      { question: "Free?" },
      { question: "Unanswered?" },
    ];
    assert.deepEqual(
      summarizeAnswers(questions, {
        action: "accept",
        content: { question_0: "a", question_0_custom: " mine ", question_1: ["x", "y"], question_2: "text" },
      }),
      { answers: { "One?": "a, mine", "Many?": "x, y", "Free?": "text", "Unanswered?": "(no answer)" } },
    );
    assert.equal(summarizeAnswers(questions, { action: "decline" }), "User skipped the question.");
    assert.equal(summarizeAnswers(questions, { action: "cancel" }), "Question dismissed.");
  });
});
