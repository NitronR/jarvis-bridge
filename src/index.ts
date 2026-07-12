// Jarvis Bridge — entry point.
//
// Startup sequence:
//   1. Load env config.
//   2. Ensure the workspace dir is ready (create if missing).
//   3. Load backend profiles + the runtime default-backend setting.
//   4. Initialize Backend Registry (spawns default backend).
//   5. Healthcheck the default backend; on failure print an actionable hint and exit.
//   6. Start the HTTP gateway.
//   7. On SIGINT / SIGTERM, shut the registry down cleanly.

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { loadBackendProfiles } from "./agent/backendConfig";
import { createSettingsStore } from "./agent/settingsStore";
import { createBackendRegistry } from "./agent/backendRegistry";
import { createServer } from "./server";
import { createToolRegistry } from "./tools";
import { attachTerminalServer } from "./terminal";

async function main(): Promise<void> {
  const cfg = loadConfig();

  // 1. Ensure workspace dir exists (agent cwd + tools realpath root).
  await fs.mkdir(cfg.workspace, { recursive: true });
  console.log(`[jarvis-bridge] workspace ${cfg.workspace}`);

  // 2. Load backend profiles + the runtime default-backend setting.
  const profiles = await loadBackendProfiles(cfg.agentsConfigPath);
  const settings = await createSettingsStore({
    path: path.join(cfg.workspace, "settings.json"),
    envDefault: cfg.defaultBackendEnv ?? profiles[0].name,
    validNames: profiles.map((p) => p.name),
  });

  // 3. Backend registry (eagerly spawns only the current default).
  const registry = await createBackendRegistry({
    profiles,
    settings,
    workspace: cfg.workspace,
    autoApprove: cfg.autoApprove,
  });

  // 4. Healthcheck the default backend.
  const defaultBackend = await registry.getDefaultBackend();
  try {
    const hc = await defaultBackend.healthcheck({ retries: 1 });
    if (!hc.ok) throw new Error(hc.detail ?? "agent healthcheck failed");
  } catch (err) {
    console.error(
      "[jarvis-bridge] agent healthcheck failed:",
      err instanceof Error ? err.message : String(err),
    );
    console.error(
      "[jarvis-bridge] hint: if the agent CLI requires login, run it once in a terminal to authenticate, then retry.",
    );
    await registry.shutdown().catch(() => {});
    process.exit(1);
  }

  // 5. Tools + server.
  const tools = createToolRegistry(cfg.workspace);
  const app = createServer({
    workspace: cfg.workspace,
    port: cfg.port,
    registry,
    tools,
  });
  const server = app.listen(cfg.port, () => {
    console.log(`[jarvis-bridge] gateway listening on http://localhost:${cfg.port}`);
    console.log(`[jarvis-bridge] workspace: ${cfg.workspace}`);
    console.log(`[jarvis-bridge] backends: ${registry.listBackendNames().join(", ")} (default: ${registry.getDefaultBackendName()})`);
  });

  attachTerminalServer({ server, workspace: cfg.workspace, enabled: cfg.shell });
  if (!cfg.shell) {
    console.log("[jarvis-bridge] terminal /terminal disabled (JARVIS_BRIDGE_SHELL=false)");
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[jarvis-bridge] ${signal} received, shutting down`);
    server.close();
    await registry.shutdown().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("[jarvis-bridge] fatal:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
