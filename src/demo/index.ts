// Demo mode wiring: the single backend profile that replaces agents.json when
// the gateway runs with `--demo` (`npm run dev:demo`). It spawns the scripted
// mock ACP agent (./mockAcpAgent) as an ordinary ACP subprocess, so everything
// from AcpAgentBackend up (mapping, elicitation routing, SSE, UI) is the real
// code path.

import path from "node:path";
import type { BackendProfile } from "../agent/backendConfig";

export const DEMO_BACKEND_NAME = "demo";
export const DEMO_BACKEND_KIND = "demo-acp";

export function createDemoBackendProfile(opts: { configPath: string }): BackendProfile {
  const agent = mockAgentCommand();
  return {
    name: DEMO_BACKEND_NAME,
    kind: DEMO_BACKEND_KIND,
    command: agent.command,
    args: agent.args,
    env: { ...agent.env, JARVIS_BRIDGE_DEMO_CONFIG: path.resolve(opts.configPath) },
  };
}

// Same Node binary as the gateway. Under ts-node (`npm run dev:demo`) the
// agent is the .ts source, so preload ts-node for it too. Paths are absolute:
// the subprocess runs with the chat's cwd, not the repo root.
export function mockAgentCommand(): { command: string; args: string[]; env: Record<string, string> } {
  const ext = path.extname(__filename);
  const script = path.join(__dirname, `mockAcpAgent${ext}`);
  if (ext !== ".ts") return { command: process.execPath, args: [script], env: {} };
  return {
    command: process.execPath,
    args: ["-r", require.resolve("ts-node/register/transpile-only"), script],
    env: { TS_NODE_PROJECT: path.resolve(__dirname, "..", "..", "tsconfig.json") },
  };
}
