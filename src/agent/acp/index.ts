// AcpAgentBackend + AcpAgentSession — the ACP-flavored AgentBackend.
//
// Translates JSON-RPC traffic on the AcpConnection into the
// backend-agnostic AgentBackend / AgentSession contract.

import {
  AcpConnection,
  AcpConnectionClosedError,
  AcpRequestError,
  type AcpSpawnOptions,
} from "./jsonrpc";
import { buildAcpPrompt } from "./prompt-content";
import {
  acpUpdateToPatches,
  patchFromPromptResult,
  resetTurnState,
  type AcpStreamState,
  type AcpUpdate,
} from "./mapping";
import type {
  AgentBackend,
  AgentCapabilities,
  AgentSession,
  ChatPatch,
  ChatSessionSummary,
  CreateSessionOptions,
  SendMessageOptions,
  SessionModelsInfo,
  UsageTotals,
} from "../types";

// ── Constants ────────────────────────────────────────────────────────────

export const ACP_PROTOCOL_VERSION = 1;
export const CLIENT_INFO = { name: "jarvis-bridge", version: "0.1.0" };
const WRAPPED_USER_MESSAGE_MARKER = "User message: ";
const STEER_EXTENSION_KEY = "jarvis-bridge/steer";

// ── Per-session state ────────────────────────────────────────────────────

interface PendingApproval {
  resolve: (optionId: string | null) => void;
}

interface SessionContext {
  busy: boolean;
  cancelRequested: boolean;
  state: AcpStreamState;
  // Active pump callback while a turn streams.
  onPatch: ((patches: ChatPatch[]) => void) | null;
  pendingApprovals: Map<string, PendingApproval>;
  // Replay capture (during loadSession):
  replayHistory: Array<
    { kind: "user"; content: string } | { kind: "assistant"; patches: ChatPatch[] }
  >;
  captureReplay: boolean;
  suppressReplayAssistant: boolean;
  lastReplayActivityAt: number;
  // Per-session overrides
  autoApproveOverride?: boolean;
  availableModels?: Array<{ modelId: string; name: string }>;
  currentModelId?: string;
  // Pump plumbing
  wakeWaiter: (() => void) | null;
}

// ── Backend ──────────────────────────────────────────────────────────────

export interface AcpBackendSpawnOptions extends AcpSpawnOptions {
  model?: string;
}

export class AcpAgentBackend implements AgentBackend {
  readonly kind = "acp";
  readonly role = "chat" as const;
  readonly capabilities: AgentCapabilities;
  private conn: AcpConnection;
  private cfg: AcpBackendSpawnOptions;
  private sessions = new Map<string, SessionContext>();
  private sessionObjects = new Map<string, AcpAgentSession>();
  private defaultAutoApprove = false;
  private alive = true;
  private model?: string;

  private constructor(conn: AcpConnection, cfg: AcpBackendSpawnOptions) {
    this.conn = conn;
    this.cfg = cfg;
    this.model = cfg.model;
    this.capabilities = {
      multipleSessions: true,
      customWorkingDirectory: true,
      cancel: true,
      // steer / canFork / images are filled in by connect()
      steer: false,
      toolApprovals: true,
      slashCommands: false,
      canFork: false,
      images: false,
      sessionDelete: false,
      promptQueueing: false,
    };
  }

  static async spawn(opts: AcpBackendSpawnOptions): Promise<AcpAgentBackend> {
    const conn = await AcpConnection.spawn(opts);
    const backend = new AcpAgentBackend(conn, opts);
    try {
      await backend.connect();
    } catch (err) {
      await conn.close();
      throw err;
    }
    return backend;
  }

  private async connect(): Promise<void> {
    // Send the ACP initialize request and negotiate capabilities.
    const initRes = (await this.conn.sendRequest("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { elicitation: { form: {} } },
      clientInfo: CLIENT_INFO,
    })) as {
      agentCapabilities?: {
        extensions?: Record<string, unknown>;
        sessionCapabilities?: Record<string, unknown>;
        promptCapabilities?: { image?: boolean };
      };
    };

    const caps = initRes.agentCapabilities ?? {};
    const hasExtension = (obj: unknown, key: string): boolean =>
      typeof obj === "object" && obj !== null && key in (obj as Record<string, unknown>);
    const steer = hasExtension(caps.extensions, STEER_EXTENSION_KEY);
    const canFork = hasExtension(caps.sessionCapabilities, "fork");
    const sessionDelete = hasExtension(caps.sessionCapabilities, "delete");
    const images = caps.promptCapabilities?.image === true;

    this.capabilities.steer = steer;
    this.capabilities.canFork = canFork;
    this.capabilities.sessionDelete = sessionDelete;
    this.capabilities.images = images;

    // Register server→client handlers.
    this.conn.onRequest("session/request_permission", async (params) => {
      const p = params as
        | {
            sessionId?: string;
            toolCall?: { toolCallId?: string };
            options?: Array<{ optionId: string; name?: string; kind?: string }>;
          }
        | undefined;
      const sid = p?.sessionId;
      const ctx = sid ? this.sessions.get(sid) : undefined;
      const effective = this.effectiveAutoApprove(ctx);
      if (effective || !ctx || !ctx.onPatch) {
        // Auto-approve → reply allow_once immediately.
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      }
      // Route to UI.
      return this.routeApprovalToUI(ctx, p);
    });

    this.conn.onRequest("elicitation/create", async () => {
      return { action: "cancel" };
    });

    this.conn.onNotification("session/update", (params) => {
      void this.handleSessionUpdate(params);
    });

    this.conn.onExit((code, signal) => {
      this.alive = false;
      for (const ctx of this.sessions.values()) {
        if (ctx.onPatch) {
          ctx.onPatch([
            {
              type: "error",
              message: `agent subprocess exited (code=${code}, signal=${signal})`,
            },
          ]);
        }
      }
    });
  }

  private async handleSessionUpdate(params: unknown): Promise<void> {
    const wrapped = params as { sessionId?: string; update?: AcpUpdate } & AcpUpdate;
    // opencode acp nests the update body under an `update` key:
    //   { sessionId, update: { sessionUpdate, content, ... } }
    // Unwrap so mapping sees the update body directly.
    const update = (wrapped.update && typeof wrapped.update === "object"
      ? wrapped.update
      : wrapped) as AcpUpdate;
    // sessionId sits on the outer envelope, NOT inside update.
    const sid = wrapped.sessionId;
    if (!sid) return;
    const ctx = this.sessions.get(sid);
    if (!ctx) return;

    // Replay capture: reconstruct user/assistant history entries from updates.
    if (ctx.captureReplay) {
      this.captureReplayUpdate(ctx, update);
    }

    const patches = acpUpdateToPatches(update, ctx.state);
    if (patches.length === 0) return;
    ctx.onPatch?.(patches);
  }

  private captureReplayUpdate(ctx: SessionContext, update: AcpUpdate & { sessionId?: string }): void {
    ctx.lastReplayActivityAt = Date.now();
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const text = extractText(update.content);
        // Reconstruct the most recent user entry.
        const last = ctx.replayHistory[ctx.replayHistory.length - 1];
        if (last && last.kind === "user") {
          last.content += text;
        } else {
          ctx.replayHistory.push({
            kind: "user",
            content: text.replace(WRAPPED_USER_MESSAGE_MARKER, ""),
          });
        }
        // The user message that follows a context-priming message is suppressed;
        // suppress the next assistant turn too.
        if (text.startsWith(WRAPPED_USER_MESSAGE_MARKER)) {
          ctx.suppressReplayAssistant = true;
        }
        break;
      }
      case "agent_message_chunk":
      case "agent_thought_chunk":
      case "tool_call":
      case "tool_call_update": {
        // Emit a placeholder assistant entry on the first content of the turn;
        // patches are streamed into it via the regular handler.
        const last = ctx.replayHistory[ctx.replayHistory.length - 1];
        if (!last || last.kind !== "assistant") {
          if (ctx.suppressReplayAssistant) {
            ctx.suppressReplayAssistant = false;
            // mark suppression by skipping the entry; create a marker
            ctx.replayHistory.push({ kind: "assistant", patches: [] });
          } else {
            ctx.replayHistory.push({ kind: "assistant", patches: [] });
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private async routeApprovalToUI(
    ctx: SessionContext,
    params:
      | {
          toolCall?: { toolCallId?: string };
          options?: Array<{ optionId: string; name?: string; kind?: string }>;
        }
      | undefined,
  ): Promise<{ outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } }> {
    const opts = params?.options ?? [];
    const toolCallId = params?.toolCall?.toolCallId ?? null;
    if (opts.length === 0) {
      return { outcome: { outcome: "cancelled" } };
    }
    const requestId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      ctx.pendingApprovals.set(requestId, {
        resolve: (optionId) => {
          if (optionId == null) {
            resolve({ outcome: { outcome: "cancelled" } });
          } else {
            resolve({ outcome: { outcome: "selected", optionId } });
          }
        },
      });
      const optPatches = opts.map((o) => ({ id: o.optionId, name: o.name ?? o.optionId, kind: o.kind }));
      // Synthesize an approval-request ChatPatch (carries the tool info we know).
      // Tool name/kind come from the live state.
      const idx = ctx.state.nextIndex++;
      const toolCall = toolCallId ? ctx.state.toolCallIndexById.get(toolCallId) : undefined;
      const toolName =
        toolCall !== undefined
          ? (`tc#${toolCall}` as string)
          : "tool";
      ctx.onPatch?.([
        {
          type: "tool-call-start",
          index: idx,
          toolCallId,
          toolName,
          argsInitial: "",
        },
        {
          type: "approval-request",
          requestId,
          toolCallId,
          toolName,
          options: optPatches,
        },
      ]);
    });
  }

  // ── Session lifecycle ────────────────────────────────────────────────

  async createSession(opts?: CreateSessionOptions): Promise<AgentSession> {
    const cwd = opts?.cwd ?? process.cwd();
    const res = (await this.conn.sendRequest("session/new", {
      cwd,
      mcpServers: [],
    })) as {
      sessionId?: string;
      configOptions?: Array<{
        id?: string;
        currentValue?: string;
        options?: Array<{ value?: string; name?: string }>;
      }>;
    };
    const sessionId = res.sessionId;
    if (!sessionId) throw new Error("agent did not return a sessionId");
    const ctx = this.makeSessionContext();
    const models = parseModels(res.configOptions);
    ctx.availableModels = models.available;
    ctx.currentModelId = models.current;
    this.sessions.set(sessionId, ctx);
    const sessionObj = new AcpAgentSession(this, sessionId, ctx);
    this.sessionObjects.set(sessionId, sessionObj);
    // Optional model pin on NEW sessions.
    if (this.model) {
      try {
        await this.setSessionModel(sessionId, this.model);
      } catch {
        // ignore — agent may not support it
      }
    }
    return sessionObj;
  }

  async loadSession(sessionId: string, opts?: CreateSessionOptions): Promise<AgentSession> {
    const cwd = opts?.cwd ?? process.cwd();
    ctx: {
      const ctx = this.makeSessionContext();
      ctx.captureReplay = true;
      ctx.suppressReplayAssistant = true; // first user msg is the wrapped one
      ctx.lastReplayActivityAt = Date.now();
      const res = (await this.conn.sendRequest("session/load", {
        sessionId,
        cwd,
        mcpServers: [],
      })) as {
        sessionId?: string;
        configOptions?: Array<{
          id?: string;
          currentValue?: string;
          options?: Array<{ value?: string; name?: string }>;
        }>;
      };
      const id = res.sessionId ?? sessionId;
      const models = parseModels(res.configOptions);
      ctx.availableModels = models.available;
      ctx.currentModelId = models.current;
      this.sessions.set(id, ctx);
      const sessionObj = new AcpAgentSession(this, id, ctx);
      this.sessionObjects.set(id, sessionObj);
      // Wait briefly for replay activity to drain.
      await this.waitForReplayIdle(ctx);
      ctx.captureReplay = false;
      return sessionObj;
    }
  }

  async listSessions(): Promise<ChatSessionSummary[]> {
    const res = (await this.conn.sendRequest("session/list", {})) as {
      sessions?: Array<{
        sessionId?: string;
        title?: string;
        updatedAt?: string;
        cwd?: string;
      }>;
    };
    return (res.sessions ?? [])
      .filter((s): s is { sessionId: string; title?: string; updatedAt?: string; cwd?: string } =>
        Boolean(s.sessionId),
      )
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        updatedAt: s.updatedAt ?? null,
        cwd: s.cwd,
      }));
  }

  async forkSession(sessionId: string, opts?: CreateSessionOptions): Promise<AgentSession> {
    if (!this.capabilities.canFork) throw new Error("fork not supported");
    const cwd = opts?.cwd ?? process.cwd();
    const res = (await this.conn.sendRequest("session/fork", {
      sessionId,
      cwd,
      mcpServers: [],
    })) as { sessionId?: string };
    if (!res.sessionId) throw new Error("agent did not return a forked sessionId");
    const ctx = this.makeSessionContext();
    this.sessions.set(res.sessionId, ctx);
    const sessionObj = new AcpAgentSession(this, res.sessionId, ctx);
    this.sessionObjects.set(res.sessionId, sessionObj);
    return sessionObj;
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.capabilities.sessionDelete) throw new Error("delete not supported by this agent");
    await this.conn.sendRequest("session/delete", { sessionId });
    this.sessions.delete(sessionId);
    this.sessionObjects.delete(sessionId);
  }

  getSession(sessionId: string): AgentSession | null {
    return this.sessionObjects.get(sessionId) ?? null;
  }

  getSessionModels(sessionId: string): SessionModelsInfo | null {
    const ctx = this.sessions.get(sessionId);
    if (!ctx || !ctx.availableModels || !ctx.currentModelId) return null;
    return { available: ctx.availableModels, current: ctx.currentModelId };
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx?.availableModels) throw new Error("unknown session or models not loaded");
    if (!ctx.availableModels.some((m) => m.modelId === modelId)) {
      throw new Error(`unknown modelId: ${modelId}`);
    }
    await this.conn.sendRequest("session/set_model", { sessionId, modelId });
    ctx.currentModelId = modelId;
  }

  // ── Healthcheck ──────────────────────────────────────────────────────

  async healthcheck(opts?: { retries?: number }): Promise<{ ok: boolean; detail?: string }> {
    if (!this.alive || this.conn.isClosed) return { ok: false, detail: "connection closed" };
    const retries = opts?.retries ?? 0;
    let lastErr: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        // Race a session/list against a short timeout.
        await Promise.race([
          this.conn.sendRequest("session/list", {}),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("healthcheck timeout")), 1500),
          ),
        ]);
        return { ok: true };
      } catch (err) {
        lastErr = err;
        if (i < retries) await new Promise((r) => setTimeout(r, 250));
      }
    }
    return {
      ok: false,
      detail: lastErr instanceof Error ? lastErr.message : String(lastErr),
    };
  }

  async shutdown(): Promise<void> {
    for (const [, ctx] of this.sessions) {
      // Resolve any dangling approvals.
      for (const [, p] of ctx.pendingApprovals) p.resolve(null);
      ctx.pendingApprovals.clear();
    }
    for (const [, s] of this.sessionObjects) {
      try {
        await s.close();
      } catch {
        /* ignore */
      }
    }
    this.sessionObjects.clear();
    await this.conn.close();
    this.alive = false;
  }

  // ── Auto-approve ────────────────────────────────────────────────────

  getDefaultAutoApprove(): boolean {
    return this.defaultAutoApprove;
  }
  setDefaultAutoApprove(v: boolean): void {
    this.defaultAutoApprove = v;
  }
  getSessionAutoApproveOverride(sessionId: string): boolean | undefined {
    return this.sessions.get(sessionId)?.autoApproveOverride;
  }
  setSessionAutoApprove(sessionId: string, v: boolean | null): void {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return;
    ctx.autoApproveOverride = v ?? undefined;
  }

  // ── Internal helpers (package-private) ──────────────────────────────

  getConnection(): AcpConnection {
    return this.conn;
  }

  getSpawnOptions(): { command: string; args: readonly string[] } {
    return { command: this.cfg.command, args: this.cfg.args };
  }

  resolveApproval(sessionId: string, requestId: string, optionId: string): boolean {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return false;
    const pending = ctx.pendingApprovals.get(requestId);
    if (!pending) return false;
    ctx.pendingApprovals.delete(requestId);
    pending.resolve(optionId);
    return true;
  }

  private effectiveAutoApprove(ctx?: SessionContext): boolean {
    return ctx?.autoApproveOverride ?? this.defaultAutoApprove;
  }

  private makeSessionContext(): SessionContext {
    const usage: UsageTotals = {
      requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    };
    const state = resetTurnState({
      nextIndex: 0,
      streamingTextIndex: null,
      streamingThoughtIndex: null,
      toolCallIndexById: new Map(),
      finalizedToolCalls: new Set(),
      usage,
      slashCommands: [],
    });
    return {
      busy: false,
      cancelRequested: false,
      state,
      onPatch: null,
      pendingApprovals: new Map(),
      replayHistory: [],
      captureReplay: false,
      suppressReplayAssistant: false,
      lastReplayActivityAt: 0,
      availableModels: undefined,
      currentModelId: undefined,
      wakeWaiter: null,
    };
  }

  private async waitForReplayIdle(ctx: SessionContext): Promise<void> {
    const start = Date.now();
    while (Date.now() - ctx.lastReplayActivityAt < 75 && Date.now() - start < 500) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

function parseModels(opts: Array<{ id?: string; currentValue?: string; options?: Array<{ value?: string; name?: string }> }> | undefined): {
  available: Array<{ modelId: string; name: string }>;
  current: string;
} {
  if (!opts) return { available: [], current: "" };
  const modelOpt = opts.find((o) => o.id === "model");
  if (!modelOpt) return { available: [], current: "" };
  const available = (modelOpt.options ?? [])
    .filter((o): o is { value: string; name?: string } => typeof o.value === "string")
    .map((o) => ({ modelId: o.value, name: o.name ?? o.value }));
  return { available, current: modelOpt.currentValue ?? available[0]?.modelId ?? "" };
}

function extractText(content: unknown): string {
  if (!content) return "";
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c && typeof (c as { text?: string }).text === "string"
        ? (c as { text: string }).text
        : ""))
      .join("");
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    const t = (content as { text?: unknown }).text;
    return typeof t === "string" ? t : "";
  }
  return "";
}

// ── Session ──────────────────────────────────────────────────────────────

export class AcpAgentSession implements AgentSession {
  readonly id: string;
  private backend: AcpAgentBackend;
  private ctx: SessionContext;
  private closed = false;

  constructor(backend: AcpAgentBackend, id: string, ctx: SessionContext) {
    this.backend = backend;
    this.id = id;
    this.ctx = ctx;
  }

  consumeReplayHistory(): Array<
    { kind: "user"; content: string } | { kind: "assistant"; patches: ChatPatch[] }
  > {
    const out = this.ctx.replayHistory.slice();
    this.ctx.replayHistory = [];
    return out;
  }

  async *sendMessage(
    message: string,
    opts?: SendMessageOptions,
  ): AsyncIterable<ChatPatch> {
    if (this.closed) {
      yield { type: "error", message: "session is closed" };
      return;
    }
    if (this.ctx.busy) {
      yield { type: "error", message: "session is busy" };
      return;
    }
    this.ctx.busy = true;
    this.ctx.cancelRequested = false;
    resetTurnState(this.ctx.state);

    try {
      // Build prompt blocks.
      const promptResult = buildAcpPrompt(message, opts?.images ?? [], {});
      if (!promptResult.ok) {
        yield { type: "error", message: promptResult.error };
        return;
      }
      if (promptResult.skipped.length > 0) {
        yield { type: "images-skipped", skipped: promptResult.skipped };
      }
      const blocks = promptResult.blocks;

      // Set up pump bridge.
      const queue: ChatPatch[] = [];
      let wakeResolver: (() => void) | null = null;
      const makeWaiter = (): Promise<void> =>
        new Promise<void>((resolve) => {
          wakeResolver = resolve;
        });
      let waiter = makeWaiter();
      this.ctx.onPatch = (patches) => {
        for (const p of patches) queue.push(p);
        const w = wakeResolver;
        wakeResolver = null;
        w?.();
      };
      let turnDone = false;
      const onAbort = () => {
        void this.cancel();
      };
      const signal = opts?.signal;
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      // Issue the prompt.
      const promptPromise = this.backend
        .getConnection()
        .sendRequest("session/prompt", { sessionId: this.id, prompt: blocks })
        .then((result) => {
          const usagePatch = patchFromPromptResult(result as never, this.ctx.state);
          if (usagePatch) queue.push(usagePatch);
        })
        .catch((err: unknown) => {
          if (err instanceof AcpRequestError) {
            queue.push({ type: "error", message: err.message });
          } else if (err instanceof AcpConnectionClosedError) {
            queue.push({ type: "error", message: "agent connection closed" });
          } else if (this.ctx.cancelRequested) {
            // suppress cancellation-noise
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            queue.push({ type: "error", message: msg });
          }
        })
        .finally(() => {
          turnDone = true;
          const w = wakeResolver;
          wakeResolver = null;
          w?.();
        });

      // Drain loop.
      while (true) {
        while (queue.length > 0) {
          const p = queue.shift()!;
          yield p;
        }
        if (turnDone) break;
        waiter = makeWaiter();
        await waiter;
      }

      // Always end with a sentinel `done` (the gateway layer surfaces this).
      yield { type: "done" } as unknown as ChatPatch;

      await promptPromise.catch(() => {
        /* already handled */
      });

      if (signal) signal.removeEventListener("abort", onAbort);
    } finally {
      this.ctx.busy = false;
      this.ctx.onPatch = null;
    }
  }

  async cancel(): Promise<void> {
    this.ctx.cancelRequested = true;
    try {
      await this.backend.getConnection().sendNotification("session/cancel", {
        sessionId: this.id,
      });
    } catch {
      /* ignore */
    }
  }

  async steer(prompt: string): Promise<{ accepted: boolean; reason?: string }> {
    if (!this.backend.capabilities.steer) {
      return { accepted: false, reason: "steer not supported by this agent" };
    }
    try {
      await this.backend.getConnection().sendRequest(STEER_EXTENSION_KEY, {
        sessionId: this.id,
        prompt,
      });
      return { accepted: true };
    } catch (err) {
      return {
        accepted: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [, p] of this.ctx.pendingApprovals) p.resolve(null);
    this.ctx.pendingApprovals.clear();
    this.ctx.onPatch = null;
  }
}