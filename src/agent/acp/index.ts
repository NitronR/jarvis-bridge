// AcpAgentBackend + AcpAgentSession — the ACP-flavored AgentBackend.
//
// Translates JSON-RPC traffic on the AcpConnection into the
// backend-agnostic AgentBackend / AgentSession contract.

import path from "node:path";
import {
  AcpConnection,
  AcpConnectionClosedError,
  AcpRequestError,
  type AcpSpawnOptions,
} from "./jsonrpc";
import { buildAcpPrompt } from "./prompt-content";
import { queryClaudeUsageViaCli } from "./claudeUsage";
import {
  acpUpdateToPatches,
  elicitationSchemaToFields,
  patchFromPromptResult,
  resetTurnState,
  type AcpElicitationSchema,
  type AcpStreamState,
  type AcpUpdate,
} from "./mapping";
import type {
  ActiveTurnHandle,
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

type ElicitationOutcome =
  | { action: "accept"; content: Record<string, unknown> }
  | { action: "decline" }
  | { action: "cancel" };

interface PendingElicitation {
  resolve: (outcome: ElicitationOutcome) => void;
}

interface SessionContext {
  busy: boolean;
  cancelRequested: boolean;
  state: AcpStreamState;
  // Active pump callback while a turn streams.
  onPatch: ((patches: ChatPatch[]) => void) | null;
  pendingApprovals: Map<string, PendingApproval>;
  pendingElicitations: Map<string, PendingElicitation>;
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
  rawConfigOptions?: Array<{ id: string; currentValue?: string; options: Array<{ value?: string; name?: string }> }>;
  modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name?: string }> };
  // Pump plumbing
  wakeWaiter: (() => void) | null;
  // In-flight turn state, buffered independent of any HTTP consumer — see
  // docs/acp-notes.md and docs/superpowers/specs/2026-07-15-agent-stream-reconnect-design.md.
  activeTurn: {
    patches: ChatPatch[];
    viewerCallback: ((patch: ChatPatch) => void) | null;
    viewerToken: unknown;
    idleTimer: NodeJS.Timeout | null;
  } | null;
}

// ── Backend ──────────────────────────────────────────────────────────────

export interface AcpBackendSpawnOptions extends AcpSpawnOptions {
  model?: string;
  kind?: string;
}

export class AcpAgentBackend implements AgentBackend {
  readonly kind: string;
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
    this.kind = cfg.kind ?? "acp";
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
      // Not part of the ACP handshake (nothing to negotiate — it's a fact
      // about shelling out to a second, independent CLI process, not this
      // connection's protocol capabilities), so this is the one capability
      // decided from the static `kind` config rather than connect()'s
      // negotiated response. See claudeUsage.ts for why.
      usageQuery: this.kind === "claude-acp",
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
        _meta?: { claudeCode?: { promptQueueing?: boolean } };
      };
    };

    const caps = initRes.agentCapabilities ?? {};
    const hasExtension = (obj: unknown, key: string): boolean =>
      typeof obj === "object" && obj !== null && key in (obj as Record<string, unknown>);
    const steer = hasExtension(caps.extensions, STEER_EXTENSION_KEY);
    const canFork = hasExtension(caps.sessionCapabilities, "fork");
    const sessionDelete = hasExtension(caps.sessionCapabilities, "delete");
    const images = caps.promptCapabilities?.image === true;
    const promptQueueing = caps._meta?.claudeCode?.promptQueueing === true;

    this.capabilities.steer = steer;
    this.capabilities.canFork = canFork;
    this.capabilities.sessionDelete = sessionDelete;
    this.capabilities.images = images;
    this.capabilities.promptQueueing = promptQueueing;

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
        // Auto-approve → select by kind, not a hardcoded optionId. optionId is
        // agent-defined and varies per backend (e.g. Claude's "allow_once"-kind
        // option has optionId "allow", not "allow_once"); kind is the stable,
        // ACP-defined vocabulary to match against.
        const opts = p?.options ?? [];
        // Only fall back to opts[0] if it's actually an allow-kind option —
        // an options list containing only reject/ask kinds must never be
        // auto-selected, or "auto-approve" would silently auto-reject.
        const chosen =
          opts.find((o) => o.kind === "allow_once") ??
          opts.find((o) => o.kind === "allow_always") ??
          opts.find((o) => o.kind?.startsWith("allow"));
        return { outcome: { outcome: "selected", optionId: chosen?.optionId ?? "allow_once" } };
      }
      // Route to UI.
      return this.routeApprovalToUI(ctx, p);
    });

    this.conn.onRequest("elicitation/create", async (params) => {
      const p = params as
        | {
            sessionId?: string;
            mode?: string;
            toolCallId?: string;
            message?: string;
            requestedSchema?: AcpElicitationSchema;
          }
        | undefined;
      const sid = p?.sessionId;
      const ctx = sid ? this.sessions.get(sid) : undefined;
      // We only advertise clientCapabilities.elicitation.form (no `url`) at
      // initialize, so a compliant agent should never send another mode here —
      // this branch is defensive, not a real live case today.
      if (!ctx || !ctx.onPatch || p?.mode !== "form") {
        return { action: "cancel" };
      }
      return this.routeElicitationToUI(ctx, p);
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

    const patches = acpUpdateToPatches(update, ctx.state);

    // Replay capture: reconstruct user/assistant history entries from updates.
    if (ctx.captureReplay) {
      this.captureReplayUpdate(ctx, update, patches);
    }

    if (patches.length === 0) return;
    ctx.onPatch?.(patches);
  }

  private captureReplayUpdate(
    ctx: SessionContext,
    update: AcpUpdate & { sessionId?: string },
    patches: ChatPatch[],
  ): void {
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
        let last = ctx.replayHistory[ctx.replayHistory.length - 1];
        if (!last || last.kind !== "assistant") {
          ctx.suppressReplayAssistant = false;
          last = { kind: "assistant", patches: [] };
          ctx.replayHistory.push(last);
        }
        last.patches.push(...patches);
        break;
      }
      case "usage_update": {
        // Attach to the current assistant entry only — a bare usage update
        // with no preceding message/tool chunk shouldn't spawn an empty
        // placeholder bubble (see docs/acp-notes.md on replay capture).
        const last = ctx.replayHistory[ctx.replayHistory.length - 1];
        if (last && last.kind === "assistant") {
          last.patches.push(...patches);
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

  private async routeElicitationToUI(
    ctx: SessionContext,
    params: { toolCallId?: string; message?: string; requestedSchema?: AcpElicitationSchema },
  ): Promise<ElicitationOutcome> {
    const fields = elicitationSchemaToFields(params.requestedSchema);
    const requestId = `elic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      ctx.pendingElicitations.set(requestId, { resolve });
      ctx.onPatch?.([
        {
          type: "elicitation-request",
          requestId,
          toolCallId: params.toolCallId ?? null,
          message: params.message ?? "",
          fields,
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
    })) as SessionConfigResponse & { sessionId?: string };
    const sessionId = res.sessionId;
    if (!sessionId) throw new Error("agent did not return a sessionId");
    const ctx = this.makeSessionContext();
    const parsed = parseSessionConfig(res);
    ctx.availableModels = parsed.models.available;
    ctx.currentModelId = parsed.models.current;
    ctx.rawConfigOptions = parsed.rawConfigOptions;
    ctx.modes = parsed.modes;
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
    const ctx = this.makeSessionContext();
    ctx.captureReplay = true;
    ctx.suppressReplayAssistant = true; // first user msg is the wrapped one
    ctx.lastReplayActivityAt = Date.now();
    // Register under the known sessionId BEFORE sending the request. Per the
    // ACP spec, the agent streams the session's history back as session/update
    // notifications WHILE session/load is in flight, not in its response body.
    // handleSessionUpdate() drops notifications for unregistered sessions, so
    // registering after the await (as this used to) silently discarded the
    // entire replay.
    this.sessions.set(sessionId, ctx);
    const sessionObj = new AcpAgentSession(this, sessionId, ctx);
    this.sessionObjects.set(sessionId, sessionObj);
    const res = (await this.conn.sendRequest("session/load", {
      sessionId,
      cwd,
      mcpServers: [],
    })) as SessionConfigResponse & { sessionId?: string };
    const parsed = parseSessionConfig(res);
    ctx.availableModels = parsed.models.available;
    ctx.currentModelId = parsed.models.current;
    ctx.rawConfigOptions = parsed.rawConfigOptions;
    ctx.modes = parsed.modes;
    // Wait briefly for replay activity to drain.
    await this.waitForReplayIdle(ctx);
    ctx.captureReplay = false;
    return sessionObj;
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
      // Claude's session/list returns the user's entire global session history
      // across every project, not scoped to this backend's workspace — filter
      // to this cwd. Sessions that don't report a cwd (e.g. opencode) pass
      // through unfiltered, since the agent already scoped them itself.
      .filter((s) => s.cwd === undefined || path.resolve(s.cwd) === path.resolve(this.cfg.cwd))
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
    try {
      await this.conn.sendRequest("session/delete", { sessionId });
    } catch (err) {
      // Claude's adapter puts the useful detail (e.g. "Session ... not found
      // in any project directory") in error.data.details, behind a generic
      // top-level "Internal error" message — fold it in so server.ts's
      // message-substring classification (404 vs 501 vs 500) still works.
      if (err instanceof AcpRequestError) {
        const data = err.data;
        const rawDetails =
          typeof data === "object" && data !== null
            ? (data as { details?: unknown }).details
            : undefined;
        const details = rawDetails != null ? String(rawDetails) : undefined;
        throw new Error(details ? `${err.message}: ${details}` : err.message);
      }
      throw err;
    }
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

  async queryUsage(): Promise<UsageTotals["rate_limits"] | null> {
    if (!this.capabilities.usageQuery) return null;
    const executable = this.cfg.env?.CLAUDE_CODE_EXECUTABLE || "claude";
    return queryClaudeUsageViaCli({ executable, cwd: this.cfg.cwd, env: this.cfg.env });
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
      for (const [, p] of ctx.pendingElicitations) p.resolve({ action: "cancel" });
      ctx.pendingElicitations.clear();
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

  getSessionRawConfig(sessionId: string): { rawConfigOptions?: SessionContext["rawConfigOptions"]; modes?: SessionContext["modes"] } | null {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return null;
    return { rawConfigOptions: ctx.rawConfigOptions, modes: ctx.modes };
  }

  resolveElicitation(
    sessionId: string,
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): boolean {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return false;
    const pending = ctx.pendingElicitations.get(requestId);
    if (!pending) return false;
    ctx.pendingElicitations.delete(requestId);
    pending.resolve(
      action === "accept" ? { action: "accept", content: content ?? {} } : { action },
    );
    return true;
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
      pendingElicitations: new Map(),
      replayHistory: [],
      captureReplay: false,
      suppressReplayAssistant: false,
      lastReplayActivityAt: 0,
      availableModels: undefined,
      currentModelId: undefined,
      wakeWaiter: null,
      activeTurn: null,
    };
  }

  private async waitForReplayIdle(ctx: SessionContext): Promise<void> {
    const start = Date.now();
    while (Date.now() - ctx.lastReplayActivityAt < 75 && Date.now() - start < 500) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

interface SessionConfigResponse {
  configOptions?: Array<{
    id?: string;
    currentValue?: string;
    options?: Array<{ value?: string; name?: string }>;
  }>;
  modes?: { currentModeId?: string; availableModes?: Array<{ id?: string; name?: string }> };
}

function parseSessionConfig(res: SessionConfigResponse | undefined): {
  models: { available: Array<{ modelId: string; name: string }>; current: string };
  rawConfigOptions: Array<{ id: string; currentValue?: string; options: Array<{ value?: string; name?: string }> }>;
  modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name?: string }> };
} {
  const opts = res?.configOptions;
  const rawConfigOptions = (opts ?? [])
    .filter((o): o is { id: string; currentValue?: string; options?: Array<{ value?: string; name?: string }> } => typeof o.id === "string")
    .map((o) => ({ id: o.id, currentValue: o.currentValue, options: o.options ?? [] }));
  const modelOpt = rawConfigOptions.find((o) => o.id === "model");
  const available = (modelOpt?.options ?? [])
    .filter((o): o is { value: string; name?: string } => typeof o.value === "string")
    .map((o) => ({ modelId: o.value, name: o.name ?? o.value }));
  const models = { available, current: modelOpt?.currentValue ?? available[0]?.modelId ?? "" };
  const modesOut = res?.modes
    ? {
        currentModeId: res.modes.currentModeId,
        availableModes: (res.modes.availableModes ?? [])
          .filter((m): m is { id: string; name?: string } => typeof m.id === "string"),
      }
    : undefined;
  return { models, rawConfigOptions, modes: modesOut };
}

function getIdleTurnGraceMs(): number {
  const raw = process.env.JARVIS_BRIDGE_IDLE_TURN_GRACE_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
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
  private turnQueue: Array<() => void> = [];

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
      if (!this.backend.capabilities.promptQueueing) {
        yield { type: "error", message: "session is busy" };
        return;
      }
      await new Promise<void>((resolve) => this.turnQueue.push(resolve));
      if (this.closed) {
        yield { type: "error", message: "session is closed" };
        return;
      }
    }
    this.ctx.busy = true;
    this.ctx.cancelRequested = false;
    resetTurnState(this.ctx.state);
    this.ctx.activeTurn = { patches: [], viewerCallback: null, viewerToken: null, idleTimer: null };

    try {
      const promptResult = buildAcpPrompt(message, opts?.images ?? [], {});
      if (!promptResult.ok) {
        yield { type: "error", message: promptResult.error };
        return;
      }

      const queue: ChatPatch[] = [];
      let wakeResolver: (() => void) | null = null;
      const makeWaiter = (): Promise<void> =>
        new Promise<void>((resolve) => {
          wakeResolver = resolve;
        });
      let waiter = makeWaiter();
      // Every patch destined for the client flows through here: buffered
      // onto activeTurn (so a later reattach can catch up) and forwarded
      // live to whichever viewer is currently attached, independent of
      // whether the original caller is still pulling this generator.
      const emit = (p: ChatPatch) => {
        queue.push(p);
        this.ctx.activeTurn?.patches.push(p);
        this.ctx.activeTurn?.viewerCallback?.(p);
        const w = wakeResolver;
        wakeResolver = null;
        w?.();
      };
      if (promptResult.skipped.length > 0) {
        emit({ type: "images-skipped", skipped: promptResult.skipped });
      }
      const blocks = promptResult.blocks;

      this.ctx.onPatch = (patches) => {
        for (const p of patches) emit(p);
      };
      let turnDone = false;

      const promptPromise = this.backend
        .getConnection()
        .sendRequest("session/prompt", { sessionId: this.id, prompt: blocks })
        .then((result) => {
          const usagePatch = patchFromPromptResult(result as never, this.ctx.state);
          if (usagePatch) emit(usagePatch);
        })
        .catch((err: unknown) => {
          if (err instanceof AcpRequestError) {
            emit({ type: "error", message: err.message });
          } else if (err instanceof AcpConnectionClosedError) {
            emit({ type: "error", message: "agent connection closed" });
          } else if (this.ctx.cancelRequested) {
            // suppress cancellation-noise
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            emit({ type: "error", message: msg });
          }
        })
        .finally(() => {
          turnDone = true;
          emit({ type: "done" } as unknown as ChatPatch);
        });

      while (true) {
        while (queue.length > 0) {
          const p = queue.shift()!;
          yield p;
        }
        if (turnDone) break;
        waiter = makeWaiter();
        await waiter;
      }

      await promptPromise.catch(() => {
        /* already handled */
      });
    } finally {
      this.ctx.busy = false;
      this.ctx.onPatch = null;
      if (this.ctx.activeTurn?.idleTimer) clearTimeout(this.ctx.activeTurn.idleTimer);
      this.ctx.activeTurn = null;
      const next = this.turnQueue.shift();
      if (next) next();
    }
  }

  getActiveTurn(): ActiveTurnHandle | null {
    const at = this.ctx.activeTurn;
    if (!at) return null;
    return {
      patches: at.patches.slice(),
      attach: (onPatch) => {
        if (at.idleTimer) {
          clearTimeout(at.idleTimer);
          at.idleTimer = null;
        }
        const token = {};
        at.viewerCallback = onPatch;
        at.viewerToken = token;
        return () => {
          if (at.viewerToken !== token) return;
          at.viewerCallback = null;
          at.viewerToken = null;
          at.idleTimer = setTimeout(() => {
            void this.cancel();
          }, getIdleTurnGraceMs());
        };
      },
    };
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

  resolveApproval(requestId: string, optionId: string): boolean {
    return this.backend.resolveApproval(this.id, requestId, optionId);
  }

  resolveElicitation(
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): boolean {
    return this.backend.resolveElicitation(this.id, requestId, action, content);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [, p] of this.ctx.pendingApprovals) p.resolve(null);
    this.ctx.pendingApprovals.clear();
    for (const [, p] of this.ctx.pendingElicitations) p.resolve({ action: "cancel" });
    this.ctx.pendingElicitations.clear();
    this.ctx.onPatch = null;
    const queue = this.turnQueue;
    this.turnQueue = [];
    for (const resolve of queue) {
      resolve();
    }
  }
}