#!/usr/bin/env node
// Minimal fake ACP agent for testing the gateway's JSON-RPC client.
// Speaks newline-delimited JSON over stdio. Behavior is driven by an
// "instruction" object passed via the `X-FakeAgent-Plan` env var (a JSON
// array of actions) so each test can script the conversation.
//
// Supported actions:
//   { "kind": "respond", "id": <n>, "result": <any> }   — reply to a request
//   { "kind": "respondError", "id": <n>, "code": <n>, "message": <s> }
//   { "kind": "notify", "method": <s>, "params": <any> } — send a notification
//   { "kind": "request", "method": <s>, "params": <any> } — send a server→client request
//   { "kind": "exit", "code": <n> }                       — exit cleanly
//
// Each action also supports an "after" delay in ms.

const readline = require("node:readline");

const planRaw = process.env.X_FAKE_AGENT_PLAN || "[]";
let plan;
try {
  plan = JSON.parse(planRaw);
} catch (err) {
  console.error("bad X_FAKE_AGENT_PLAN", err);
  process.exit(2);
}

const stderrLog = process.env.X_FAKE_AGENT_STDERR_LOG;
if (stderrLog) {
  process.stderr.write(`fake agent started, ${plan.length} actions\n`);
}

const rl = readline.createInterface({ input: process.stdin });
let nextId = 1;
let closed = false;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function schedule(idx) {
  const action = plan[idx];
  if (!action) return;
  const after = action.after ?? 0;
  setTimeout(() => {
    if (closed) return;
    switch (action.kind) {
      case "respond":
        emit({ jsonrpc: "2.0", id: action.id, result: action.result });
        break;
      case "respondError":
        emit({
          jsonrpc: "2.0",
          id: action.id,
          error: { code: action.code, message: action.message },
        });
        break;
      case "notify":
        emit({ jsonrpc: "2.0", method: action.method, params: action.params });
        break;
      case "request":
        // server→client request: needs an id so client can reply
        emit({
          jsonrpc: "2.0",
          id: nextId++,
          method: action.method,
          params: action.params,
        });
        break;
      case "exit":
        process.exit(action.code ?? 0);
        return;
    }
    schedule(idx + 1);
  }, after);
}

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // tolerate non-JSON like a real agent's startup logs
  }
  if (typeof msg !== "object" || msg === null) return;
  if (msg.jsonrpc !== "2.0") return;
  // Default: log unrecognized requests to stderr so the client gets a chance
  // to react (e.g. elicitations / permissions). Real handling happens via
  // the scripted plan, not here.
  if (stderrLog) {
    process.stderr.write(`fake agent received: ${line}\n`);
  }
});

rl.on("close", () => {
  closed = true;
  process.exit(0);
});

// Kick off the plan
schedule(0);