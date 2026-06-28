// Jarvis Bridge — entry point.
//
// Startup sequence:
//   1. Load env config.
//   2. Ensure the workspace dir is ready (create if missing, copy template).
//   3. Spawn the ACP agent backend.
//   4. Build the per-cwd backend pool seeded with the default backend.
//   5. Healthcheck the agent; on failure print an actionable hint and exit.
//   6. Start the HTTP gateway; serve the SPA from public/.
//   7. On SIGINT / SIGTERM, shut the backend down cleanly.

import "dotenv/config";
import fs from "node:fs/promises";
import { loadConfig } from "./config";
import { createAgentBackend } from "./agent";
import { createBackendPool } from "./agent/backendPool";
import { createServer } from "./server";
import { createToolRegistry } from "./tools";

async function main(): Promise<void> {
  const cfg = loadConfig();

  // 1. Ensure workspace dir exists (agent cwd + tools realpath root).
  await fs.mkdir(cfg.workspace, { recursive: true });
  console.log(`[jarvis-bridge] workspace ${cfg.workspace}`);

  // 2. Spawn the ACP agent backend (or stub when AGENT_CMD is empty).
  let chatBackend;
  if (cfg.agent.command) {
    chatBackend = await createAgentBackend(
      "chat",
      {
        command: cfg.agent.command,
        args: cfg.agent.args,
        model: cfg.agent.model,
      },
      { workspace: cfg.workspace },
    );
  } else {
    console.warn(
      "[jarvis-bridge] AGENT_CMD not set — using stub backend (no real agent).",
    );
    const { StubBackend } = await import("./stubBackend");
    chatBackend = new StubBackend();
  }
  chatBackend.setDefaultAutoApprove?.(cfg.agent.autoApprove);

  // 3. Per-cwd backend pool.
  const pool = await createBackendPool(chatBackend, cfg.workspace, async () =>
    createAgentBackend(
      "chat",
      { command: cfg.agent.command, args: cfg.agent.args, model: cfg.agent.model },
      { workspace: cfg.workspace },
    ),
  );

  // 4. Healthcheck.
  try {
    const hc = await chatBackend.healthcheck({ retries: 1 });
    if (!hc.ok) throw new Error(hc.detail ?? "agent healthcheck failed");
  } catch (err) {
    console.error(
      "[jarvis-bridge] agent healthcheck failed:",
      err instanceof Error ? err.message : String(err),
    );
    console.error(
      "[jarvis-bridge] hint: if the agent CLI requires login, run it once in a terminal to authenticate, then retry.",
    );
    await chatBackend.shutdown().catch(() => {});
    process.exit(1);
  }

  // 5. Tools + server.
  const tools = createToolRegistry(cfg.workspace);
  const app = createServer({
    workspace: cfg.workspace,
    port: cfg.port,
    chatBackend,
    backendPool: pool,
    injectContext: cfg.injectContext,
    injectContextMode: cfg.injectContextMode,
    autoApprove: { default: cfg.agent.autoApprove },
    tools,
  });
  const server = app.listen(cfg.port, () => {
    console.log(
      `[jarvis-bridge] gateway listening on http://localhost:${cfg.port}`,
    );
    console.log(`[jarvis-bridge] workspace: ${cfg.workspace}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[jarvis-bridge] ${signal} received, shutting down`);
    server.close();
    await chatBackend.shutdown().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(
    "[jarvis-bridge] fatal:",
    err instanceof Error ? err.stack ?? err.message : String(err),
  );
  process.exit(1);
});
