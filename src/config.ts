// Env → typed config. Pure parsing — no side effects on the filesystem
// beyond expanding `~` in workspace paths.

import os from "node:os";
import path from "node:path";

export interface AppConfig {
  port: number;
  workspace: string;
  systemDir: string;
  agentsConfigPath: string;
  defaultBackendEnv?: string;
  autoApprove: boolean;
  shell: boolean;
  slackToken?: string;
  gatewayUrl: string;
  logFile?: string;
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function boolOpt(v: string | undefined, enableValue: "true" | "false" = "true"): boolean {
  if (enableValue === "true") return v === "true";
  return v !== "false";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const workspace = expandHome(
    env.JARVIS_BRIDGE_WORKSPACE ?? "~/.jarvis-bridge",
  );
  // Sibling to `workspace`, never nested under it — deliberately outside
  // pathGuard's boundary so agents.json/settings.json/session_metadata.json
  // (backend spawn commands, potential secrets in agents.json's `env`) are
  // never reachable through the agent's own sandboxed file tools.
  const systemDir = expandHome(
    env.JARVIS_BRIDGE_SYSTEM_DIR ?? "~/.jarvis-bridge-system",
  );
  const port = Number(env.PORT ?? 3001);
  const agentsConfigPath =
    env.JARVIS_BRIDGE_AGENTS_CONFIG ?? path.join(systemDir, "config", "agents.json");
  return {
    port,
    workspace,
    systemDir,
    agentsConfigPath,
    defaultBackendEnv: env.JARVIS_BRIDGE_DEFAULT_BACKEND?.trim() || undefined,
    autoApprove: boolOpt(env.AGENT_AUTO_APPROVE),
    shell: boolOpt(env.JARVIS_BRIDGE_SHELL, "false"),
    slackToken: env.SLACK_BOT_TOKEN?.trim() || undefined,
    gatewayUrl: env.JARVIS_BRIDGE_GATEWAY_URL ?? "http://localhost:3001",
    logFile: env.JARVIS_BRIDGE_LOG_FILE?.trim() || path.join(systemDir, "logs", "gateway.log"),
  };
}
