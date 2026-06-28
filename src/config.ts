// Env → typed config. Pure parsing — no side effects on the filesystem
// beyond expanding `~` in workspace paths.

import os from "node:os";
import path from "node:path";

export interface AppConfig {
  port: number;
  workspace: string;
  agent: {
    command: string;
    args: readonly string[];
    model?: string;
    autoApprove: boolean;
  };
  injectContext: boolean;
  injectContextMode: "paths" | "full";
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
  const agentCommand = env.AGENT_CMD ?? "";
  const agentArgs = (env.AGENT_ARGS ?? "").trim().length
    ? env.AGENT_ARGS!.trim().split(/\s+/)
    : [];
  const injectContextMode: "paths" | "full" =
    env.INJECT_CONTEXT_MODE === "full" ? "full" : "paths";
  return {
    port,
    workspace,
    agent: {
      command: agentCommand,
      args: agentArgs,
      model: env.AGENT_MODEL?.trim() || undefined,
      autoApprove: boolOpt(env.AGENT_AUTO_APPROVE),
    },
    injectContext: boolOpt(env.INJECT_CONTEXT, "false"),
    injectContextMode,
    shell: boolOpt(env.JARVIS_BRIDGE_SHELL, "false"),
    slackToken: env.SLACK_BOT_TOKEN?.trim() || undefined,
    gatewayUrl: env.JARVIS_BRIDGE_GATEWAY_URL ?? "http://localhost:3001",
  };
}
