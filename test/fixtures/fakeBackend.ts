// Minimal in-memory AgentBackend for tests. Mirrors the parts of the
// AcpAgentBackend surface that the gateway's HTTP layer actually uses.

import type {
  AgentBackend,
  AgentCapabilities,
  AgentSession,
  ChatPatch,
  ChatSessionSummary,
  SendMessageOptions,
} from "../agent/types";

export class FakeSession implements AgentSession {
  readonly id: string;
  private opts: { patches: ChatPatch[] };
  public steerHandler: ((p: string) => Promise<{ accepted: boolean; reason?: string }>) | null = null;
  public cancelled = 0;
  public sentMessages: Array<{ message: string; opts?: SendMessageOptions }> = [];
  public approvals: Array<{ requestId: string; optionId: string }> = [];
  constructor(id: string, patches: ChatPatch[]) {
    this.id = id;
    this.opts = { patches };
  }
  async *sendMessage(
    message: string,
    opts?: SendMessageOptions,
  ): AsyncIterable<ChatPatch> {
    this.sentMessages.push({ message, opts });
    for (const p of this.opts.patches) {
      // Honor abort signal.
      if (opts?.signal?.aborted) {
        yield { type: "error", message: "aborted" };
        return;
      }
      yield p;
    }
  }
  async cancel(): Promise<void> {
    this.cancelled++;
  }
  async steer(p: string) {
    if (this.steerHandler) return this.steerHandler(p);
    return { accepted: false, reason: "no handler" };
  }
  resolveApproval(requestId: string, optionId: string): boolean {
    this.approvals.push({ requestId, optionId });
    return true;
  }
  async close(): Promise<void> {}
}

export interface FakeBackendOptions {
  capabilities?: Partial<AgentCapabilities>;
  slashCommands?: Array<{ name: string; description?: string }>;
  models?: Array<{ modelId: string; name: string }>;
  initialSessionId?: string;
  initialSessionPatches?: ChatPatch[];
  listSessions?: ChatSessionSummary[];
  steerSupported?: boolean;
}

export class FakeBackend implements AgentBackend {
  readonly kind = "fake";
  readonly role = "chat" as const;
  readonly capabilities: AgentCapabilities;
  readonly sessions = new Map<string, FakeSession>();
  public createdSessions: Array<{ sessionId: string }> = [];
  public listSessionsResult: ChatSessionSummary[] | null;
  public forked: string[] = [];
  public currentModelBySession = new Map<string, string>();
  public autoApproveDefault = false;
  public autoApproveOverrides = new Map<string, boolean>();
  constructor(public readonly opts: FakeBackendOptions = {}) {
    this.capabilities = {
      multipleSessions: true,
      customWorkingDirectory: true,
      cancel: true,
      steer: opts.steerSupported ?? true,
      toolApprovals: true,
      slashCommands: (opts.slashCommands ?? []).length > 0,
      canFork: true,
      images: false,
      sessionDelete: opts.capabilities?.sessionDelete ?? false,
      promptQueueing: opts.capabilities?.promptQueueing ?? false,
      ...opts.capabilities,
    };
    this.listSessionsResult = opts.listSessions ?? null;
    if (opts.initialSessionId && opts.initialSessionPatches) {
      this.sessions.set(
        opts.initialSessionId,
        new FakeSession(opts.initialSessionId, opts.initialSessionPatches),
      );
    }
  }
  async healthcheck() {
    return { ok: true };
  }
  async createSession() {
    const id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    const session = new FakeSession(id, this.opts.initialSessionPatches ?? [
      { type: "text-delta", index: 0, delta: "hi from fake" },
      { type: "done" } as ChatPatch,
    ]);
    this.sessions.set(id, session);
    this.createdSessions.push({ sessionId: id });
    return session;
  }
  async loadSession(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`unknown session: ${sessionId}`);
    return s;
  }
  async listSessions() {
    return this.listSessionsResult ?? Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.id,
      title: `Session ${s.id}`,
      updatedAt: new Date().toISOString(),
    }));
  }
  async forkSession(sessionId: string) {
    this.forked.push(sessionId);
    const newId = `fork-${sessionId}-${Math.random().toString(36).slice(2, 6)}`;
    const s = new FakeSession(newId, []);
    this.sessions.set(newId, s);
    return s;
  }
  public deletedSessions: string[] = [];
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) throw new Error(`unknown session: ${sessionId}`);
    this.sessions.delete(sessionId);
    this.deletedSessions.push(sessionId);
  }
  getSession(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) ?? null;
  }
  getSessionModels(sessionId: string) {
    const m = this.opts.models ?? [{ modelId: "fake/model", name: "Fake Model" }];
    return {
      available: m,
      current: this.currentModelBySession.get(sessionId) ?? m[0].modelId,
    };
  }
  async setSessionModel(sessionId: string, modelId: string) {
    this.currentModelBySession.set(sessionId, modelId);
  }
  getSlashCommands() {
    return this.opts.slashCommands ?? [];
  }
  getDefaultAutoApprove(): boolean {
    return this.autoApproveDefault;
  }
  setDefaultAutoApprove(v: boolean): void {
    this.autoApproveDefault = v;
  }
  getSessionAutoApproveOverride(sessionId: string): boolean | undefined {
    return this.autoApproveOverrides.get(sessionId);
  }
  setSessionAutoApprove(sessionId: string, v: boolean | null): void {
    if (v == null) {
      this.autoApproveOverrides.delete(sessionId);
    } else {
      this.autoApproveOverrides.set(sessionId, v);
    }
  }
  async shutdown() {}
}
