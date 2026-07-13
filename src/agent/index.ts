// Factory entry point for the ACP agent backend. Pass-through to AcpAgentBackend.spawn.

import { AcpAgentBackend } from "./acp/index";
import type { AgentBackend, AgentBackendConfig } from "./types";

export interface CreateAgentBackendOptions {
  workspace: string;
  logsDir?: string;
}

export async function createAgentBackend(
  role: "chat",
  cfg: AgentBackendConfig,
  opts: CreateAgentBackendOptions,
): Promise<AgentBackend> {
  if (role !== "chat") throw new Error(`unsupported role: ${role}`);
  const stderrLogPath = opts.logsDir
    ? `${opts.logsDir.replace(/\/$/, "")}/agent-chat-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
    : undefined;

  // cfg.env is a partial override (e.g. agents.json's "env": {}), not a full
  // environment — merge over process.env rather than replacing it, or a
  // profile with any env entries loses PATH/HOME entirely (AcpConnection.spawn
  // only falls back to process.env when env is nullish, not when it's `{}`).
  return AcpAgentBackend.spawn({
    kind: cfg.kind,
    command: cfg.command,
    args: cfg.args,
    cwd: opts.workspace,
    env: { ...process.env, ...cfg.env },
    model: cfg.model,
    stderrLogPath,
  });
}