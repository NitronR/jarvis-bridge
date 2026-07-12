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

  let env = cfg.env;
  if (cfg.kind === "claude-acp") {
    env = { ...process.env, ...cfg.env };
    env.CLAUDE_MOCK_PROMPT_FLOWS = "true";
    if (env.FORCE_COLOR === undefined) {
      env.FORCE_COLOR = "0";
    }
  }

  return AcpAgentBackend.spawn({
    kind: cfg.kind,
    command: cfg.command,
    args: cfg.args,
    cwd: opts.workspace,
    env,
    model: cfg.model,
    stderrLogPath,
  });
}