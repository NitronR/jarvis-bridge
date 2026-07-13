import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  acpUpdateToPatches,
  resetTurnState,
  usageFromAcp,
  mergeUsage,
  patchFromPromptResult,
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