// Env → typed config. Pure parsing — no side effects on the filesystem
// beyond expanding `~` in workspace paths.

import os from "node:os";
import path from "node:path";

export interface AppConfig {
  port: number;
  workspace: string;
  agentsConfigPath: string;
  defaultBackendEnv?: string;
  autoApprove: boolean;
  shell: boolean;
  slackToken?: string;
  gatewayUrl: string;
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
  const port = Number(env.PORT ?? 3001);
  const agentsConfigPath = env.JARVIS_BRIDGE_AGENTS_CONFIG ?? "./agents.json";
  return {
    port,
    workspace,
    agentsConfigPath,
    defaultBackendEnv: env.JARVIS_BRIDGE_DEFAULT_BACKEND?.trim() || undefined,
    autoApprove: boolOpt(env.AGENT_AUTO_APPROVE),
    shell: boolOpt(env.JARVIS_BRIDGE_SHELL, "false"),
    slackToken: env.SLACK_BOT_TOKEN?.trim() || undefined,
    gatewayUrl: env.JARVIS_BRIDGE_GATEWAY_URL ?? "http://localhost:3001",
  };
}
