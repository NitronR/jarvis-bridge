#!/usr/bin/env node
// Streaming-aware fake ACP agent for testing the full backend/session pipeline.
// Behavior driven by env vars (defaults below).
//
//   X_FAKE_AGENT_NEW_TEXT — JSON array of strings to stream as text chunks
//                            (default: ["hello from agent"])
//   X_FAKE_AGENT_TOOL_CALL — JSON object: { toolCallId, title, kind, rawInput, output }
//                            (default: null — no tool call)
//   X_FAKE_AGENT_DELAY_MS — delay before sending chunks (default 20)

const readline = require("node:readline");

let newText;
try {
  newText = JSON.parse(process.env.X_FAKE_AGENT_NEW_TEXT || '["hello from agent"]');
} catch {
  newText = ["hello from agent"];
}

let toolCall = null;
try {
  const raw = process.env.X_FAKE_AGENT_TOOL_CALL;
  if (raw) toolCall = JSON.parse(raw);
} catch {
  toolCall = null;
}

const delayMs = parseInt(process.env.X_FAKE_AGENT_DELAY_MS || "20", 10);
const advertiseDelete = process.env.X_FAKE_AGENT_SESSION_DELETE === "true";

let nextId = 1;
let nextSessionId = 1;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });

function reply(id, result) {
  emit({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  emit({ jsonrpc: "2.0", id, error: { code, message } });
}

function makeSessionId() {
  return `sess-${nextSessionId++}`;
}

function chunkDelay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handlePrompt(id, params, sessionId) {
  const chunkEvery = 15;
  // text chunks
  let cumulative = "";
  for (let i = 0; i < newText.length; i++) {
    const t = newText[i];
    emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: t },
        },
      },
    });
    cumulative += t;
    await chunkDelay(chunkEvery);
  }
  if (toolCall) {
    // tool_call (without rawInput) → tool-call-start
    emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: toolCall.toolCallId,
          toolCall: {
            toolCallId: toolCall.toolCallId,
            title: toolCall.title,
            kind: toolCall.kind,
          },
        },
      },
    });
    await chunkDelay(chunkEvery);
    // tool_call_update with rawInput → tool-call-finalized
    emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          rawInput: toolCall.rawInput,
        },
      },
    });
    await chunkDelay(chunkEvery);
    // tool_call_update completed → tool-return
    emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          status: "completed",
          rawOutput: toolCall.output,
        },
      },
    });
    await chunkDelay(chunkEvery);
  }
  // usage
  emit({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "usage_update",
        inputTokens: 11,
        outputTokens: cumulative.length,
        cachedReadTokens: 4,
      },
    },
  });
  // final result
  reply(id, {
    stopReason: "end_turn",
    usage: {
      inputTokens: 11,
      outputTokens: cumulative.length,
      cachedReadTokens: 4,
    },
  });
}

rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!msg || msg.jsonrpc !== "2.0") return;

  if (typeof msg.method !== "string") return; // response — ignore

  switch (msg.method) {
    case "initialize":
      reply(msg.id, {
        protocolVersion: 1,
        agentCapabilities: {
          promptCapabilities: { image: true },
          sessionCapabilities: advertiseDelete ? { fork: {}, delete: {} } : { fork: {} },
          extensions: { "jarvis-bridge/steer": {} },
        },
        agentInfo: { name: "fake-agent", version: "0.0.1" },
      });
      break;
    case "session/new":
      reply(msg.id, {
        sessionId: makeSessionId(),
        configOptions: [
          {
            id: "model",
            currentValue: "fake-model",
            options: [
              { value: "fake-model", name: "Fake Model" },
              { value: "another", name: "Another Model" },
            ],
          },
        ],
      });
      break;
    case "session/load":
      reply(msg.id, { sessionId: msg.params?.sessionId ?? makeSessionId() });
      break;
    case "session/list":
      reply(msg.id, { sessions: [] });
      break;
    case "session/fork":
      reply(msg.id, { sessionId: makeSessionId() });
      break;
    case "session/delete":
      reply(msg.id, {});
      break;
    case "session/set_model":
      reply(msg.id, null);
      break;
    case "session/cancel":
      // fire-and-forget notification
      if (typeof msg.id === "number" || typeof msg.id === "string") {
        reply(msg.id, null);
      }
      break;
    case "session/prompt": {
      const sid = msg.params?.sessionId ?? "unknown";
      if (delayMs > 0) await chunkDelay(delayMs);
      await handlePrompt(msg.id, msg.params, sid);
      break;
    }
    default:
      replyError(msg.id, -32601, `method not found: ${msg.method}`);
  }
});

rl.on("close", () => process.exit(0));