import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  acpUpdateToPatches,
  resetTurnState,
  usageFromAcp,
  mergeUsage,
  patchFromPromptResult,
  elicitationSchemaToFields,
  type AcpUpdate,
  type AcpStreamState,
} from "./mapping";

function freshState(): AcpStreamState {
  return resetTurnState({
    nextIndex: 0,
    streamingTextIndex: null,
    streamingThoughtIndex: null,
    toolCallIndexById: new Map(),
    finalizedToolCalls: new Set(),
    usage: {
      requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    },
    slashCommands: [],
  });
}

describe("acpUpdateToPatches — text/thought channels", () => {
  test("first agent_message_chunk emits text-start with content", () => {
    const state = freshState();
    const update: AcpUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello" },
    };
    const patches = acpUpdateToPatches(update, state);
    assert.equal(patches.length, 1);
    const p = patches[0]!;
    assert.equal(p.type, "text-start");
    assert.equal(p.content, "Hello");
    assert.equal(p.index, 0);
    assert.equal(state.streamingTextIndex, 0);
    assert.equal(state.nextIndex, 1);
  });

  test("subsequent agent_message_chunk on same stream emits text-delta", () => {
    const state = freshState();
    acpUpdateToPatches(
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } },
      state,
    );
    const patches = acpUpdateToPatches(
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } },
      state,
    );
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0], { type: "text-delta", index: 0, delta: "lo" });
  });

  test("thought channel is separate from text", () => {
    const state = freshState();
    const textPatches = acpUpdateToPatches(
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } },
      state,
    );
    const thoughtPatches = acpUpdateToPatches(
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "reasoning" } },
      state,
    );
    assert.equal(textPatches[0]?.type, "text-start");
    assert.equal(thoughtPatches[0]?.type, "thought-start");
    assert.notEqual(textPatches[0]!.index, thoughtPatches[0]!.index);
  });

  test("user_message_chunk emits no patches", () => {
    const state = freshState();
    const patches = acpUpdateToPatches(
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: "user msg" } },
      state,
    );
    assert.deepEqual(patches, []);
  });
});

describe("acpUpdateToPatches — tool calls", () => {
  test("tool_call without rawInput emits only tool-call-start", () => {
    const state = freshState();
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        toolCall: { toolCallId: "tc-1", title: "read", kind: "fs.read" },
      },
      state,
    );
    assert.equal(patches.length, 1);
    assert.equal(patches[0]!.type, "tool-call-start");
    const p = patches[0] as Extract<typeof patches[0], { type: "tool-call-start" }>;
    assert.equal(p.toolCallId, "tc-1");
    assert.equal(p.toolName, "read");
    assert.equal(state.toolCallIndexById.get("tc-1"), p.index);
    assert.equal(state.finalizedToolCalls.has("tc-1"), false);
  });

  test("tool_call with title/kind flat on the update (real ACP wire shape) uses them, not the 'tool' fallback", () => {
    const state = freshState();
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Read",
        kind: "read",
      },
      state,
    );
    const p = patches[0] as Extract<typeof patches[0], { type: "tool-call-start" }>;
    assert.equal(p.toolName, "Read");
  });

  test("tool_call with neither flat nor nested title/kind falls back to 'tool'", () => {
    const state = freshState();
    const patches = acpUpdateToPatches(
      { sessionUpdate: "tool_call", toolCallId: "tc-1" },
      state,
    );
    const p = patches[0] as Extract<typeof patches[0], { type: "tool-call-start" }>;
    assert.equal(p.toolName, "tool");
  });

  test("tool_call WITH rawInput emits start + finalized exactly once", () => {
    const state = freshState();
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        toolCall: {
          toolCallId: "tc-1",
          title: "read",
          kind: "fs.read",
          rawInput: { path: "package.json" },
        },
      },
      state,
    );
    assert.equal(patches.length, 2);
    assert.equal(patches[0]!.type, "tool-call-start");
    assert.equal(patches[1]!.type, "tool-call-finalized");
    const f = patches[1] as Extract<typeof patches[1], { type: "tool-call-finalized" }>;
    assert.deepEqual(f.args, { path: "package.json" });
    assert.equal(state.finalizedToolCalls.has("tc-1"), true);
  });

  test("tool_call_update carrying rawInput after a rawInput-less tool_call emits exactly one finalized", () => {
    const state = freshState();
    acpUpdateToPatches(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        toolCall: { toolCallId: "tc-1", title: "read", kind: "fs.read" },
      },
      state,
    );
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        rawInput: { path: "package.json" },
      },
      state,
    );
    assert.equal(patches.length, 1);
    assert.equal(patches[0]!.type, "tool-call-finalized");
  });

  test("tool_call_update completed emits finalized (if needed) + tool-return", () => {
    const state = freshState();
    acpUpdateToPatches(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        toolCall: {
          toolCallId: "tc-1",
          title: "read",
          kind: "fs.read",
          rawInput: { path: "package.json" },
        },
      },
      state,
    );
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        status: "completed",
        rawOutput: { ok: true, content: "{}" },
      },
      state,
    );
    // finalized already emitted; only tool-return now
    assert.equal(patches.length, 1);
    assert.equal(patches[0]!.type, "tool-return");
  });

  test("tool_call_update failed emits tool-error", () => {
    const state = freshState();
    acpUpdateToPatches(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        toolCall: {
          toolCallId: "tc-1",
          title: "read",
          kind: "fs.read",
          rawInput: { path: "x" },
        },
      },
      state,
    );
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        status: "failed",
        content: [{ type: "text", text: "ENOENT" }],
      },
      state,
    );
    assert.equal(patches.length, 1);
    assert.equal(patches[0]!.type, "tool-error");
    const e = patches[0] as Extract<typeof patches[0], { type: "tool-error" }>;
    assert.match(e.content, /ENOENT/);
  });

  test("tool_call with rawInput: {} defers finalized until real args arrive on tool_call_update", () => {
    const state = freshState();
    const startPatches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        toolCall: { toolCallId: "tc-1", title: "read", kind: "fs.read", rawInput: {} },
      },
      state,
    );
    assert.equal(startPatches.length, 1);
    assert.equal(startPatches[0]!.type, "tool-call-start");
    assert.equal(state.finalizedToolCalls.has("tc-1"), false);

    const updatePatches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        rawInput: { path: "package.json" },
      },
      state,
    );
    assert.equal(updatePatches.length, 1);
    assert.equal(updatePatches[0]!.type, "tool-call-finalized");
    const f = updatePatches[0] as Extract<typeof updatePatches[0], { type: "tool-call-finalized" }>;
    assert.deepEqual(f.args, { path: "package.json" });
  });

  test("tool_call_update in_progress emits no patches", () => {
    const state = freshState();
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        status: "in_progress",
      },
      state,
    );
    assert.deepEqual(patches, []);
  });
});

describe("acpUpdateToPatches — usage & slash commands", () => {
  test("usage_update emits usage patch with merged totals", () => {
    const state = freshState();
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "usage_update",
        inputTokens: 10,
        outputTokens: 5,
        cachedReadTokens: 3,
      },
      state,
    );
    assert.equal(patches.length, 1);
    assert.equal(patches[0]!.type, "usage");
    const u = (patches[0] as Extract<typeof patches[0], { type: "usage" }>).usage;
    assert.equal(u.input_tokens, 10);
    assert.equal(u.output_tokens, 5);
    assert.equal(u.cache_read_tokens, 3);
  });

  test("available_commands_update strips leading slash and caches", () => {
    const state = freshState();
    const patches = acpUpdateToPatches(
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "/help", description: "show help" },
          { name: "compact", description: "summarize" },
        ],
      },
      state,
    );
    assert.equal(patches.length, 1);
    assert.equal(patches[0]!.type, "slash-commands");
    const c = (patches[0] as Extract<typeof patches[0], { type: "slash-commands" }>).commands;
    assert.equal(c[0]!.name, "help");
    assert.equal(c[1]!.name, "compact");
    assert.deepEqual(state.slashCommands, c);
  });

  test("unknown sessionUpdate emits no patches", () => {
    const state = freshState();
    const patches = acpUpdateToPatches({ sessionUpdate: "current_mode_update" }, state);
    assert.deepEqual(patches, []);
  });
});

describe("usageFromAcp / mergeUsage", () => {
  test("accepts camelCase", () => {
    const u = usageFromAcp({
      inputTokens: 10,
      outputTokens: 5,
      cachedReadTokens: 2,
      cachedWriteTokens: 1,
    });
    assert.deepEqual(u, {
      requests: 0,
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
    });
  });

  test("accepts snake_case", () => {
    const u = usageFromAcp({
      input_tokens: 7,
      output_tokens: 3,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    assert.equal(u?.input_tokens, 7);
    assert.equal(u?.output_tokens, 3);
  });

  test("returns null when all token counts are zero", () => {
    assert.equal(usageFromAcp({}), null);
    assert.equal(
      usageFromAcp({ inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 }),
      null,
    );
  });

  // Regression: claude-agent-acp's usage_update notifications carry ONLY
  // `used`/`size`/`cost` — no inputTokens/outputTokens/cachedReadTokens/
  // cachedWriteTokens at all (confirmed against dist/acp-agent.js). The
  // original null-check only looked at token counts, so every real claude
  // usage_update was discarded and the context-usage indicator never had
  // data to show for claude sessions.
  test("accepts a claude-shaped update with only used/size/cost, no token breakdown", () => {
    const u = usageFromAcp({ used: 32921, size: 200000, cost: { amount: 0.42, currency: "USD" } });
    assert.ok(u, "should not be null when size/used/cost are present");
    assert.equal(u!.context_limit, 200000);
    assert.equal(u!.context_used, 32921);
    assert.equal(u!.cost?.amount, 0.42);
    assert.equal(u!.input_tokens, 0);
  });

  test("mergeUsage sums token counts", () => {
    const a = {
      requests: 0,
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 1,
      cache_write_tokens: 0,
    };
    const b = {
      requests: 0,
      input_tokens: 3,
      output_tokens: 2,
      cache_read_tokens: 0,
      cache_write_tokens: 4,
    };
    const m = mergeUsage(a, b);
    assert.equal(m.input_tokens, 13);
    assert.equal(m.output_tokens, 7);
    assert.equal(m.cache_read_tokens, 1);
    assert.equal(m.cache_write_tokens, 4);
  });

  // claude-agent-acp forwards subscription rate-limit info (from the SDK's
  // `rate_limit_event`) as `usage_update._meta["_claude/rateLimit"]`. This
  // carries no token counts at all, so it must survive the same
  // "anything present" null-check as the used/size/cost-only shape above.
  test("accepts a rate-limit-only update via _meta, no tokens/limit/cost", () => {
    const u = usageFromAcp({
      _meta: {
        "_claude/rateLimit": {
          status: "allowed",
          rateLimitType: "five_hour",
          utilization: 0.12,
          resetsAt: 1234567890, // wire value is Unix epoch *seconds*
        },
      },
    });
    assert.ok(u, "should not be null when only rate-limit meta is present");
    assert.deepEqual(u!.rate_limits, {
      // normalized to epoch ms (regression: was passed through unconverted,
      // which put every reset time near Jan 1970 in the UI)
      five_hour: { status: "allowed", utilization: 0.12, resetsAt: 1234567890000 },
    });
  });

  test("ignores malformed rate-limit meta (missing rateLimitType/status)", () => {
    const u = usageFromAcp({ used: 100, size: 200, _meta: { "_claude/rateLimit": { utilization: 0.5 } } });
    assert.ok(u);
    assert.equal(u!.rate_limits, undefined);
  });

  test("mergeUsage merges rate_limits by key instead of replacing wholesale", () => {
    const a = { requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
      rate_limits: { five_hour: { status: "allowed" as const, utilization: 0.1 } } };
    const b = { requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
      rate_limits: { seven_day: { status: "allowed_warning" as const, utilization: 0.86 } } };
    const m = mergeUsage(a, b);
    assert.deepEqual(m.rate_limits, {
      five_hour: { status: "allowed", utilization: 0.1 },
      seven_day: { status: "allowed_warning", utilization: 0.86 },
    });
  });
});

describe("resetTurnState", () => {
  test("clears indices, finalized set, and usage; keeps slashCommands", () => {
    const state = freshState();
    state.slashCommands = [{ name: "help" }];
    state.nextIndex = 5;
    state.streamingTextIndex = 3;
    state.toolCallIndexById.set("tc-1", 4);
    state.finalizedToolCalls.add("tc-1");
    state.usage.input_tokens = 999;

    const r = resetTurnState(state);
    assert.equal(r.nextIndex, 0);
    assert.equal(r.streamingTextIndex, null);
    assert.equal(r.streamingThoughtIndex, null);
    assert.equal(r.toolCallIndexById.size, 0);
    assert.equal(r.finalizedToolCalls.size, 0);
    assert.equal(r.usage.input_tokens, 0);
    assert.equal(r.slashCommands.length, 1);
    assert.equal(r.slashCommands[0]!.name, "help");
  });

  // rate_limit_events are infrequent (only fire when the quota changes), so a
  // fresh turn shouldn't blank out the last known session/week percentages
  // the way it blanks per-turn token counts.
  test("preserves rate_limits across a turn reset", () => {
    const state = freshState();
    state.usage.rate_limits = { five_hour: { status: "allowed", utilization: 0.12 } };
    const r = resetTurnState(state);
    assert.deepEqual(r.usage.rate_limits, { five_hour: { status: "allowed", utilization: 0.12 } });
  });
});

describe("patchFromPromptResult", () => {
  test("emits usage patch when result carries non-zero usage", () => {
    const state = freshState();
    const patch = patchFromPromptResult(
      {
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      state,
    );
    assert.ok(patch);
    assert.equal(patch!.type, "usage");
    const u = (patch as Extract<typeof patch, { type: "usage" }>).usage;
    assert.equal(u.input_tokens, 10);
  });

  test("returns null when no usage info present", () => {
    const state = freshState();
    const patch = patchFromPromptResult({ stopReason: "end_turn" }, state);
    assert.equal(patch, null);
  });
});

describe("elicitationSchemaToFields", () => {
  test("oneOf property becomes a single-select field", () => {
    const fields = elicitationSchemaToFields({
      properties: {
        question_0: {
          title: "Pick one",
          oneOf: [
            { const: "a", title: "Option A", description: "first" },
            { const: "b", title: "Option B" },
          ],
        },
      },
    });
    assert.equal(fields.length, 1);
    assert.deepEqual(fields[0], {
      key: "question_0",
      title: "Pick one",
      description: undefined,
      kind: "select",
      options: [
        { value: "a", label: "Option A", description: "first" },
        { value: "b", label: "Option B", description: undefined },
      ],
    });
  });

  test("array type with items.anyOf becomes a multi-select field", () => {
    const fields = elicitationSchemaToFields({
      properties: {
        question_0: {
          type: "array",
          items: { anyOf: [{ const: "x", title: "X" }, { const: "y", title: "Y" }] },
        },
      },
    });
    assert.equal(fields[0]!.kind, "multi-select");
    assert.deepEqual(fields[0]!.options, [
      { value: "x", label: "X", description: undefined },
      { value: "y", label: "Y", description: undefined },
    ]);
  });

  test("plain string property becomes a text field", () => {
    const fields = elicitationSchemaToFields({
      properties: { question_0_custom: { type: "string", title: "Other" } },
    });
    assert.equal(fields[0]!.kind, "text");
    assert.equal(fields[0]!.options, undefined);
  });

  test("unrecognized property type falls back to text rather than dropping it", () => {
    const fields = elicitationSchemaToFields({
      properties: { count: { type: "number" as never, title: "Count" } },
    });
    assert.equal(fields.length, 1);
    assert.equal(fields[0]!.kind, "text");
  });

  test("missing/empty schema yields no fields", () => {
    assert.deepEqual(elicitationSchemaToFields(undefined), []);
    assert.deepEqual(elicitationSchemaToFields({}), []);
  });
});