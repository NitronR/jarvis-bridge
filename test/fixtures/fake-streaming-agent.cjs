#!/usr/bin/env node
// Streaming-aware fake ACP agent for testing the full backend/session pipeline.
// Behavior driven by env vars (defaults below).
//
//   X_FAKE_AGENT_NEW_TEXT — JSON array of strings to stream as text chunks
//                            (default: ["hello from agent"])
//   X_FAKE_AGENT_TOOL_CALL — JSON object: { toolCallId, title, kind, rawInput, output }
//                            (default: null — no tool call)
//   X_FAKE_AGENT_DELAY_MS — delay before sending chunks (default 20)
//   X_FAKE_AGENT_PERMISSION_OPTIONS — JSON array of { optionId, kind, name } sent as the
//                            `options` of a session/request_permission call before the
//                            prompt finalizes. Mirrors the real Claude adapter's shape,
//                            where optionId (e.g. "allow") and kind (e.g. "allow_once")
//                            are distinct strings — see docs/agent-claude-code.md.
//   X_FAKE_AGENT_PERMISSION_RESULT_FILE — path to write the client's
//                            session/request_permission response as JSON, for the test
//                            to assert against.
//   X_FAKE_AGENT_SESSION_LIST — JSON array of { sessionId, cwd, title, updatedAt } to
//                            return from session/list (default: []). Mirrors the real
//                            Claude adapter, which returns sessions across every
//                            project the user has ever used, not just this cwd.
//   X_FAKE_AGENT_SESSION_DELETE_ERROR — JSON { code, message, data } to return as a
//                            session/delete error response instead of success. Mirrors
//                            the real Claude adapter's shape: a generic top-level
//                            message ("Internal error") with the useful detail nested
//                            under data.details.
//   X_FAKE_AGENT_REPLAY_UPDATES — JSON array of session/update `update` bodies (e.g.
//                            { sessionUpdate: "agent_message_chunk", content: {...} })
//                            emitted as notifications while session/load is still
//                            pending, mirroring how a real agent streams history back
//                            in flight rather than in the session/load response body.
//   X_FAKE_AGENT_ELICITATION_REQUEST — JSON object: { mode, message, toolCallId,
//                            requestedSchema } sent as the params of an
//                            elicitation/create call before the prompt finalizes.
//                            Mirrors the real Claude adapter's AskUserQuestion shape —
//                            see docs/agent-claude-code.md §8.
//   X_FAKE_AGENT_ELICITATION_RESULT_FILE — path to write the client's
//                            elicitation/create response as JSON, for the test to
//                            assert against.

const readline = require("node:readline");
const fs = require("node:fs");

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
const advertisePromptQueueing = process.env.X_FAKE_AGENT_PROMPT_QUEUEING === "true";
const claudeStyleConfig = process.env.X_FAKE_AGENT_CLAUDE_STYLE_CONFIG === "true";

let permissionOptions = null;
try {
  const raw = process.env.X_FAKE_AGENT_PERMISSION_OPTIONS;
  if (raw) permissionOptions = JSON.parse(raw);
} catch {
  permissionOptions = null;
}
const permissionResultFile = process.env.X_FAKE_AGENT_PERMISSION_RESULT_FILE || null;

let sessionList = [];
try {
  const raw = process.env.X_FAKE_AGENT_SESSION_LIST;
  if (raw) sessionList = JSON.parse(raw);
} catch {
  sessionList = [];
}

let sessionDeleteError = null;
try {
  const raw = process.env.X_FAKE_AGENT_SESSION_DELETE_ERROR;
  if (raw) sessionDeleteError = JSON.parse(raw);
} catch {
  sessionDeleteError = null;
}

let replayUpdates = [];
try {
  const raw = process.env.X_FAKE_AGENT_REPLAY_UPDATES;
  if (raw) replayUpdates = JSON.parse(raw);
} catch {
  replayUpdates = [];
}

let elicitationRequest = null;
try {
  const raw = process.env.X_FAKE_AGENT_ELICITATION_REQUEST;
  if (raw) elicitationRequest = JSON.parse(raw);
} catch {
  elicitationRequest = null;
}
const elicitationResultFile = process.env.X_FAKE_AGENT_ELICITATION_RESULT_FILE || null;

const eventLogFile = process.env.X_FAKE_AGENT_EVENT_LOG_FILE || null;
function logEvent(method) {
  if (!eventLogFile) return;
  fs.appendFileSync(eventLogFile, JSON.stringify({ method, t: Date.now() }) + "\n");
}

let nextId = 1;
let nextSessionId = 1;
let nextAgentRequestId = 1;
const pendingFromAgent = new Map();

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });

function reply(id, result) {
  emit({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message, data) {
  emit({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });
}

function sendRequestToClient(method, params) {
  const id = `agent-${nextAgentRequestId++}`;
  emit({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => {
    pendingFromAgent.set(id, resolve);
  });
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
  if (permissionOptions) {
    const result = await sendRequestToClient("session/request_permission", {
      sessionId,
      toolCall: { toolCallId: "perm-probe" },
      options: permissionOptions,
    });
    if (permissionResultFile) {
      fs.writeFileSync(permissionResultFile, JSON.stringify(result));
    }
  }
  if (elicitationRequest) {
    const result = await sendRequestToClient("elicitation/create", {
      sessionId,
      ...elicitationRequest,
    });
    if (elicitationResultFile) {
      fs.writeFileSync(elicitationResultFile, JSON.stringify(result));
    }
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

  if (typeof msg.method !== "string") {
    // response to a request we sent (e.g. session/request_permission)
    const resolve = pendingFromAgent.get(msg.id);
    if (resolve) {
      pendingFromAgent.delete(msg.id);
      resolve(msg.result);
    }
    return;
  }

  logEvent(msg.method);
  switch (msg.method) {
    case "initialize":
      reply(msg.id, {
        protocolVersion: 1,
        agentCapabilities: {
          promptCapabilities: { image: true },
          sessionCapabilities: advertiseDelete ? { fork: {}, delete: {} } : { fork: {} },
          extensions: { "jarvis-bridge/steer": {} },
          ...(advertisePromptQueueing ? { _meta: { claudeCode: { promptQueueing: true } } } : {}),
        },
        agentInfo: { name: "fake-agent", version: "0.0.1" },
      });
      break;
    case "session/new":
      reply(msg.id, claudeStyleConfig
        ? {
            sessionId: makeSessionId(),
            modes: { currentModeId: "default", availableModes: [{ id: "default" }, { id: "plan" }] },
            configOptions: [
              { id: "model", currentValue: "claude-fake", options: [{ value: "claude-fake", name: "Claude Fake" }] },
              { id: "effort", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
            ],
          }
        : {
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
    case "session/load": {
      const sid = msg.params?.sessionId ?? makeSessionId();
      for (const update of replayUpdates) {
        emit({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: sid, update },
        });
      }
      reply(msg.id, claudeStyleConfig
        ? {
            sessionId: sid,
            modes: { currentModeId: "default", availableModes: [{ id: "default" }, { id: "plan" }] },
            configOptions: [
              { id: "model", currentValue: "claude-fake", options: [{ value: "claude-fake", name: "Claude Fake" }] },
              { id: "effort", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
            ],
          }
        : {
            sessionId: sid,
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
    }
    case "session/list":
      reply(msg.id, { sessions: sessionList });
      break;
    case "session/fork":
      reply(msg.id, { sessionId: makeSessionId() });
      break;
    case "session/delete":
      if (sessionDeleteError) {
        replyError(msg.id, sessionDeleteError.code, sessionDeleteError.message, sessionDeleteError.data);
      } else {
        reply(msg.id, {});
      }
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