// Minimal stand-in backend for when AGENT_CMD is unset. Lets the gateway
// boot so the SPA loads, but /chat/send will surface an error when the
// model is actually asked to reply. Intended only for dev/UX checks.

import type {
  AgentBackend,
  AgentCapabilities,
  AgentSession,
  ChatPatch,
  ChatSessionSummary,
} from "./agent/types";

export class StubBackend implements AgentBackend {
  readonly kind = "stub";
  readonly role = "chat" as const;
  readonly capabilities: AgentCapabilities = {
    multipleSessions: true,
    customWorkingDirectory: false,
    cancel: false,
    steer: false,
    toolApprovals: false,
    slashCommands: false,
    canFork: false,
    images: false,
  };
  private autoApprove = false;
  private overrides = new Map<string, boolean>();

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
  async createSession(): Promise<AgentSession> {
    return new StubSession(`stub-${Math.random().toString(36).slice(2, 10)}`);
  }
  getSession(sessionId: string): AgentSession | null {
    return sessionId.startsWith("stub-") ? new StubSession(sessionId) : null;
  }
  async listSessions(): Promise<ChatSessionSummary[]> {
    return [];
  }
  getDefaultAutoApprove(): boolean {
    return this.autoApprove;
  }
  setDefaultAutoApprove(v: boolean): void {
    this.autoApprove = v;
  }
  getSessionAutoApproveOverride(id: string): boolean | undefined {
    return this.overrides.get(id);
  }
  setSessionAutoApprove(id: string, v: boolean | null): void {
    if (v == null) this.overrides.delete(id);
    else this.overrides.set(id, v);
  }
  async shutdown(): Promise<void> {}
}

class StubSession implements AgentSession {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  async *sendMessage(): AsyncIterable<ChatPatch> {
    yield {
      type: "error",
      message:
        "no agent is configured (AGENT_CMD is empty). Set it in .env to enable chat.",
    };
    yield { type: "done" } as unknown as ChatPatch;
  }
  async cancel(): Promise<void> {}
  async close(): Promise<void> {}
}
