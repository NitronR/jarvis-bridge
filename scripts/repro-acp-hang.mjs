import { AcpConnection, AcpSpawnOptions } from "./src/agent/acp/jsonrpc.js";

const NPX_CACHE = "/Users/bhanu-mac/.npm/_npx/b555b4fead8494dc/node_modules/@agentclientprotocol/claude-agent-acp";
const CLAUDE_BIN = "/Users/bhanu-mac/.local/bin/claude";

async function main() {
  console.log("Spawning claude-agent-acp...");
  const opts: AcpSpawnOptions = {
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp@0.66.0"],
    cwd: "/tmp",
    stderrLogPath: "/tmp/acp-repro-stderr.log",
    env: {
      ...process.env,
      CLAUDE_CODE_EXECUTABLE: CLAUDE_BIN,
    },
  };

  const conn = await AcpConnection.spawn(opts);
  console.log("Connected, initializing...");

  const initRes = await conn.sendRequest("initialize", {
    protocolVersion: 1,
    clientInfo: { name: "jarvis-bridge-repro", version: "0.1.0" },
    capabilities: {},
  });
  console.log("Initialized:", JSON.stringify(initRes));

  // Create a session
  const sessionRes = await conn.sendRequest("session/new", {}) as { sessionId: string };
  console.log("Session created:", sessionRes.sessionId);

  // Set up notification handlers to see what's coming
  conn.onNotification("session/update", (params: unknown) => {
    console.log("SESSION UPDATE:", JSON.stringify(params).slice(0, 200));
  });
  conn.onNotification("session/started", (params: unknown) => {
    console.log("SESSION STARTED:", JSON.stringify(params));
  });

  // Send a simple prompt that should complete normally
  console.log("\nSending prompt...");
  const promptBlocks = [
    { type: "text", text: "Say 'hello' in exactly one word." },
  ];

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("PROMPT TIMEOUT: 30s exceeded — session/prompt never resolved")), 30_000);
  });

  try {
    const result = await Promise.race([
      conn.sendRequest("session/prompt", { sessionId: sessionRes.sessionId, prompt: promptBlocks }),
      timeout,
    ]);
    console.log("\nPrompt resolved:", JSON.stringify(result).slice(0, 300));
  } catch (err) {
    console.error("\nPrompt failed:", (err as Error).message);
  }

  // Cleanup
  console.log("\nCleaning up...");
  await conn.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
