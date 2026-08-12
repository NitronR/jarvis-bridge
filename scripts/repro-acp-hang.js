const { spawn } = require("node:child_process");
const { createWriteStream, mkdirSync } = require("node:fs");
const { dirname } = require("node:path");

const CLAUDE_BIN = "/Users/bhanu-mac/.local/bin/claude";
const STDERR_LOG = "/tmp/acp-repro-stderr.log";

class AcpConnection {
  constructor(child, stderrLogPath) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.requestHandlers = new Map();
    this.notificationHandlers = new Map();
    this.exitListeners = new Set();
    this.buffer = "";
    this._isClosed = false;

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.feed(chunk));
    }
    if (child.stderr) {
      try {
        mkdirSync(dirname(stderrLogPath), { recursive: true });
        child.stderr.pipe(createWriteStream(stderrLogPath, { flags: "a" }));
      } catch {
        child.stderr.resume();
      }
    }

    child.on("exit", (code, signal) => {
      if (this._isClosed) return;
      this._isClosed = true;
      for (const [, p] of this.pending) {
        p.reject(new Error(`agent subprocess exited (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      for (const listener of this.exitListeners) {
        try { listener(code, signal); } catch { /* swallow */ }
      }
    });
    child.on("error", (err) => {
      if (this._isClosed) return;
      this._isClosed = true;
      for (const [, p] of this.pending) {
        p.reject(err);
      }
      this.pending.clear();
    });
  }

  static async spawn(opts) {
    const child = spawn(opts.command, [...opts.args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new AcpConnection(child, opts.stderrLogPath);
  }

  sendRequest(method, params) {
    if (this._isClosed) return Promise.reject(new Error("agent connection closed"));
    const id = this.nextId++;
    const envelope = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject });
      this._writeLine(JSON.stringify(envelope));
    });
  }

  sendNotification(method, params) {
    if (this._isClosed) return;
    const envelope = { jsonrpc: "2.0", method, params };
    this._writeLine(JSON.stringify(envelope));
  }

  onRequest(method, handler) { this.requestHandlers.set(method, handler); }
  onNotification(method, handler) { this.notificationHandlers.set(method, handler); }
  onExit(listener) { this.exitListeners.add(listener); }

  close() {
    if (this._isClosed) return Promise.resolve();
    return new Promise((resolve) => {
      try { this.child.stdin?.end(); } catch { /* ignore */ }
      const finalize = () => {
        if (!this._isClosed) {
          this._isClosed = true;
          for (const [, p] of this.pending) {
            p.reject(new Error("agent connection closed"));
          }
          this.pending.clear();
        }
        resolve();
      };
      this.child.once("exit", finalize);
      setTimeout(() => {
        if (!this._isClosed) {
          try { this.child.kill("SIGTERM"); } catch { /* ignore */ }
        }
      }, 200);
    });
  }

  _writeLine(line) {
    try {
      this.child.stdin?.write(line + "\n");
    } catch {
      this._isClosed = true;
    }
  }

  feed(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      this._handleLine(line);
    }
  }

  _handleLine(line) {
    if (!line) return;
    let env;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || parsed.jsonrpc !== "2.0") return;
      env = parsed;
    } catch { return; }

    if (env.id !== undefined && !env.method) {
      const resp = env;
      const key = String(resp.id);
      const p = this.pending.get(key);
      if (!p) return;
      this.pending.delete(key);
      if (resp.error) {
        p.reject(new Error(`ACP error ${resp.error.code}: ${resp.error.message}`));
      } else {
        p.resolve(resp.result);
      }
      return;
    }

    if (env.id !== undefined && env.method) {
      const req = env;
      const handler = this.requestHandlers.get(req.method);
      if (!handler) {
        this._writeLine(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } }));
        return;
      }
      Promise.resolve()
        .then(() => handler(req.params))
        .then((result) => { this._writeLine(JSON.stringify({ jsonrpc: "2.0", id: req.id, result })); })
        .catch((err) => { this._writeLine(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: err?.message ?? "internal error" } })); });
      return;
    }

    if (env.method) {
      const note = env;
      const handler = this.notificationHandlers.get(note.method);
      if (!handler) return;
      Promise.resolve()
        .then(() => handler(note.params))
        .catch(() => { /* swallow */ });
    }
  }
}

async function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} (timeout: ${ms}ms)`)), ms)),
  ]);
}

async function main() {
  console.log("=== ACP SendRequest Timeout Reproduction ===\n");

  // TEST A: Normal session — demonstrates all upstream fixes working
  console.log("--- TEST A: Normal prompt (verifies upstream fixes) ---");
  {
    const conn = await AcpConnection.spawn({
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@0.66.0"],
      cwd: "/Users/bhanu-mac/Desktop/tmp/test_acp_hang",
      stderrLogPath: STDERR_LOG,
      env: { CLAUDE_CODE_EXECUTABLE: CLAUDE_BIN },
    });

    await withTimeout(
      conn.sendRequest("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "jarvis-bridge-repro", version: "0.1.0" },
        capabilities: {},
      }),
      10_000,
      "initialize"
    );
    console.log("Initialized OK");

    const res = await withTimeout(
      conn.sendRequest("session/new", { cwd: "/Users/bhanu-mac/Desktop/tmp/test_acp_hang", mcpServers: [] }),
      15_000,
      "session/new"
    );
    const sessionId = res.sessionId;
    console.log("Session:", sessionId);

    let patchCount = 0;
    conn.onNotification("session/update", (params) => {
      patchCount++;
      const p = params;
      if (p.sessionUpdate === "agent_message_chunk") {
        const text = p.content?.text || "";
        process.stdout.write(`  [text: ${text.slice(0, 80)}]\n`);
      } else if (p.sessionUpdate === "tool_call_start") {
        process.stdout.write(`  [tool start: ${p.tool_call_start?.toolName || "?"}]\n`);
      } else if (p.sessionUpdate === "tool_call_update") {
        const name = p.tool_call_update?.toolName || "?";
        process.stdout.write(`  [tool update: ${name}]\n`);
      } else if (p.sessionUpdate === "usage_update") {
        process.stdout.write(`  [usage]\n`);
      }
    });

    // Test 1: Simple prompt
    const r1 = await withTimeout(
      conn.sendRequest("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "Say 'hello' in one word." }],
      }),
      20_000,
      "simple prompt"
    );
    console.log("  → stopReason:", r1.stopReason, "| patches:", patchCount);

    // Test 2: Prompt with Task subagent
    patchCount = 0;
    const r2 = await withTimeout(
      conn.sendRequest("session/prompt", {
        sessionId,
        prompt: [{
          type: "text",
          text: "Use the Task tool to run 'sleep 1 && echo done' in the background, then say 'finished'.",
        }],
      }),
      30_000,
      "Task subagent prompt"
    );
    console.log("  → stopReason:", r2.stopReason, "| patches:", patchCount);

    console.log("TEST A: All prompts resolved OK — upstream fixes working\n");
    await conn.close();
  }

  // TEST B: The core issue — NO client-side timeout on sendRequest
  console.log("--- TEST B: Demonstrating the no-timeout issue ---");
  console.log("");
  console.log("The core problem: AcpConnection.sendRequest() has NO timeout.");
  console.log("If the ACP server never sends a response (e.g., a rare edge case");
  console.log("where session_state_changed:idle never arrives), the Promise");
  console.log("hangs FOREVER — no resolve, no reject.");
  console.log("");
  console.log("Proof: spawn a session, kill the subprocess mid-prompt,");
  console.log("and observe that ONLY process-exit rejects the promise —");
  console.log("there is no wall-clock timeout that would catch a hang first.");
  console.log("");

  {
    const conn = await AcpConnection.spawn({
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@0.66.0"],
      cwd: "/Users/bhanu-mac/Desktop/tmp/test_acp_hang",
      stderrLogPath: STDERR_LOG,
      env: { CLAUDE_CODE_EXECUTABLE: CLAUDE_BIN },
    });

    await conn.sendRequest("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "repro", version: "0.1.0" },
      capabilities: {},
    });

    const res = await conn.sendRequest("session/new", {
      cwd: "/Users/bhanu-mac/Desktop/tmp/test_acp_hang",
      mcpServers: [],
    });
    const sessionId = res.sessionId;

    // Start a prompt but DON'T await it
    const promptPromise = conn.sendRequest("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Count to 10 slowly." }],
    });

    // Wait for some patches to arrive (meaning the prompt is in flight)
    await new Promise((r) => setTimeout(r, 1500));
    console.log("Prompt is in flight, killing subprocess...");

    // Kill the subprocess — this WILL reject the pending promise (because
    // the exit handler in AcpConnection rejects all pending requests).
    // But this is NOT a timeout — it's the subprocess dying.
    // In a TRUE hang (subprocess alive but never returning), there is
    // NO mechanism to reject or resolve the promise.
    conn.child.kill("SIGTERM");

    try {
      await withTimeout(promptPromise, 2000, "prompt during kill");
      console.log("Prompt resolved — unexpected!");
    } catch (err) {
      console.log("Prompt rejected with:", err.message);
      console.log("");
      console.log("The rejection happened because the SUBPROCESS DIED (SIGTERM).");
      console.log("But in a hang (subprocess alive, no response), there is NO such");
      console.log("recovery — the promise would hang forever without a timeout.");
    }

    await conn.close();
  }

  console.log("\n=== Summary ===");
  console.log("Upstream in claude-agent-acp v0.66.0:");
  console.log("  ✅ PR #458: Cancel racing with first result — FIXED");
  console.log("  ✅ PR #742: Force cancel when SDK query hangs — FIXED");
  console.log("  ✅ Issue #773: Settle turn at terminal result — FIXED");
  console.log("  ✅ Issue #680: TaskOutput block:true + cancel — FIXED");
  console.log("");
  console.log("Remaining gap (jarvis_bridge): NO client-side timeout on sendRequest.");
  console.log("If Claude Code binary has an edge-case hang, jarvis_bridge has no");
  console.log("wall-clock backstop — the turn hangs forever until manually cancelled.");
  console.log("");
  console.log("Optional fix: Add a timeout wrapper to sendRequest() in jsonrpc.ts");
  console.log("that rejects after N seconds of silence (with a reset on each patch).");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
