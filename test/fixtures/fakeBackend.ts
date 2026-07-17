// Minimal in-memory AgentBackend for tests. Mirrors the parts of the
// AcpAgentBackend surface that the gateway's HTTP layer actually uses.

import type {
  ActiveTurnHandle,
  AgentBackend,
  AgentCapabilities,
  AgentSession,
  ChatPatch,
  ChatSessionSummary,
  SendMessageOptions,
  UsageTotals,
} from "../agent/types";

export class FakeSession implements AgentSession {
  readonly id: string;
  private opts: { patches: ChatPatch[]; patchDelayMs: number };
  public steerHandler: ((p: string) => Promise<{ accepted: boolean; reason?: string }>) | null = null;
  public cancelled = 0;
  public sentMessages: Array<{ message: string; opts?: SendMessageOptions }> = [];
  public approvals: Array<{ requestId: string; optionId: string }> = [];
  public elicitations: Array<{ requestId: string; action: string; content?: Record<string, unknown> }> = [];
  private turnActive = false;
  private activeTurnPatches: ChatPatch[] = [];
  private activeTurnViewer: ((p: ChatPatch) => void) | null = null;
  constructor(id: string, patches: ChatPatch[], patchDelayMs = 0) {
    this.id = id;
    this.opts = { patches, patchDelayMs };
  }
  async *sendMessage(
    message: string,
    opts?: SendMessageOptions,
  ): AsyncIterable<ChatPatch> {
    this.sentMessages.push({ message, opts });
    this.turnActive = true;
    this.activeTurnPatches = [];
    try {
      for (const p of this.opts.patches) {
        if (opts?.signal?.aborted) {
          yield { type: "error", message: "aborted" };
          return;
        }
        if (this.opts.patchDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.opts.patchDelayMs));
        }
        this.activeTurnPatches.push(p);
        this.activeTurnViewer?.(p);
        yield p;
      }
    } finally {
      this.turnActive = false;
      this.activeTurnViewer = null;
    }
  }
  getActiveTurn(): ActiveTurnHandle | null {
    if (!this.turnActive) return null;
    return {
      patches: this.activeTurnPatches.slice(),
      attach: (onPatch) => {
        this.activeTurnViewer = onPatch;
        return () => {
          if (this.activeTurnViewer === onPatch) this.activeTurnViewer = null;
        };
      },
    };
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
  resolveElicitation(
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): boolean {
    this.elicitations.push({ requestId, action, content });
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
  patchDelayMs?: number;
  // Present (even if it throws) to exercise the supported path; omitted
  // (default) to exercise the 501-not-supported path, matching how
  // server.ts gates /chat/usage on method presence, not a capability flag.
  queryUsage?: () => Promise<UsageTotals["rate_limits"] | null>;
}

export class FakeBackend implements AgentBackend {
  readonly kind = "fake";
  readonly role = "chat" as const;
  readonly capabilities: AgentCapabilities;
  readonly sessions = new Map<string, FakeSession>();
  public createdSessions: Array<{ sessionId: string }> = [];
  public createdWithCwd = new Map<string, string | undefined>();
  public loadedWithCwd: Array<{ sessionId: string; cwd: string | undefined }> = [];
  public listSessionsResult: ChatSessionSummary[] | null;
  public forked: string[] = [];
  public currentModelBySession = new Map<string, string>();
  public autoApproveDefault = false;
  public autoApproveOverrides = new Map<string, boolean>();
  public queryUsage?: () => Promise<UsageTotals["rate_limits"] | null>;
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
      usageQuery: opts.capabilities?.usageQuery ?? !!opts.queryUsage,
      ...opts.capabilities,
    };
    this.listSessionsResult = opts.listSessions ?? null;
    if (opts.queryUsage) this.queryUsage = opts.queryUsage;
    if (opts.initialSessionId && opts.initialSessionPatches) {
      this.sessions.set(
        opts.initialSessionId,
        new FakeSession(opts.initialSessionId, opts.initialSessionPatches, opts.patchDelayMs ?? 0),
      );
    }
  }
  async healthcheck() {
    return { ok: true };
  }
  async createSession(opts?: { cwd?: string }) {
    const id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    const session = new FakeSession(
      id,
      this.opts.initialSessionPatches ?? [
        { type: "text-delta", index: 0, delta: "hi from fake" },
        { type: "done" } as ChatPatch,
      ],
      this.opts.patchDelayMs ?? 0,
    );
    this.sessions.set(id, session);
    this.createdSessions.push({ sessionId: id });
    this.createdWithCwd.set(id, opts?.cwd);
    return session;
  }
  async loadSession(sessionId: string, opts?: { cwd?: string }) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`unknown session: ${sessionId}`);
    this.loadedWithCwd.push({ sessionId, cwd: opts?.cwd });
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
    const s = new FakeSession(newId, [], this.opts.patchDelayMs ?? 0);
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
