// Backend-agnostic agent contracts shared by the gateway and all transports.
// The ACP implementation lives under src/agent/acp/ and conforms to these.

export interface AgentCapabilities {
  multipleSessions: boolean;
  customWorkingDirectory: boolean;
  cancel: boolean;
  steer: boolean;
  toolApprovals: boolean;
  slashCommands: boolean;
  canFork: boolean;
  images: boolean;
  sessionDelete: boolean;
  promptQueueing: boolean;
  // On-demand subscription rate-limit query (see AgentBackend.queryUsage) —
  // true only for backends that can shell out to a CLI that supports it
  // (currently just Claude).
  usageQuery: boolean;
}

export interface SendMessageOptions {
  signal?: AbortSignal;
  images?: PromptImageAttachment[];
}

export interface ActiveTurnHandle {
  // Patches produced by this turn so far, oldest first (snapshot at call time).
  patches: ChatPatch[];
  // Register to receive patches emitted after this call, replacing any
  // previous registration (single viewer, latest wins). Pass null to mark
  // this caller as a connected-but-passive viewer (e.g. the original
  // /chat/send request, which already receives patches by iterating the
  // generator directly and doesn't need a push callback) — this still
  // participates in the idle-turn grace-period bookkeeping. Returns a
  // detach function to call when this viewer disconnects.
  attach(onPatch: ((patch: ChatPatch) => void) | null): () => void;
}

export type ChatHistoryEntry =
  | { kind: "user"; content: string }
  | { kind: "assistant"; patches: ChatPatch[] };

export interface AgentSession {
  readonly id: string;
  sendMessage(
    message: string,
    opts?: SendMessageOptions,
  ): AsyncIterable<ChatPatch>;
  cancel(): Promise<void>;
  steer?(prompt: string): Promise<{ accepted: boolean; reason?: string }>;
  resolveApproval?(requestId: string, optionId: string): boolean;
  resolveElicitation?(
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): boolean;
  getSlashCommands?(): Array<{ name: string; description?: string }>;
  consumeReplayHistory?(): ChatHistoryEntry[];
  getActiveTurn?(): ActiveTurnHandle | null;
  close(): Promise<void>;
}

export interface CreateSessionOptions {
  cwd?: string;
  label?: string;
}

export interface ChatSessionSummary {
  sessionId: string;
  title?: string;
  updatedAt?: string | null;
  cwd?: string;
  customTitle?: string;
  pinned?: boolean;
  group?: string;
  displayTitle?: string;
}

export interface SessionModelsInfo {
  available: Array<{ modelId: string; name: string }>;
  current: string;
}

export interface AgentBackend {
  readonly kind: string;
  readonly role: "chat";
  readonly capabilities: AgentCapabilities;

  healthcheck(opts?: { retries?: number }): Promise<{ ok: boolean; detail?: string }>;
  createSession(opts?: CreateSessionOptions): Promise<AgentSession>;

  loadSession?(
    sessionId: string,
    opts?: CreateSessionOptions,
  ): Promise<AgentSession>;
  listSessions?(): Promise<ChatSessionSummary[]>;
  forkSession?(
    sessionId: string,
    opts?: CreateSessionOptions,
  ): Promise<AgentSession>;
  getSession?(sessionId: string): AgentSession | null;
  getSessionModels?(sessionId: string): SessionModelsInfo | null;
  setSessionModel?(sessionId: string, modelId: string): Promise<void>;
  getSlashCommands?(): Array<{ name: string; description?: string }>;
  deleteSession?(sessionId: string): Promise<void>;

  // Auto-approve (backend-wide default + per-session override).
  getDefaultAutoApprove?(): boolean;
  setDefaultAutoApprove?(v: boolean): void;
  getSessionAutoApproveOverride?(sessionId: string): boolean | undefined;
  setSessionAutoApprove?(sessionId: string, v: boolean | null): void;

  // On-demand subscription rate-limit query — account-level, not tied to any
  // particular session. Gated by capabilities.usageQuery; present only when
  // the backend can actually service it.
  queryUsage?(): Promise<UsageTotals["rate_limits"] | null>;

  shutdown(): Promise<void>;
}

export interface PromptImageAttachment {
  data: string;
  mimeType: string;
  filename?: string;
}

// ── Elicitation (ACP `elicitation/create`, form mode) ────────────────────

// Normalized, protocol-generic rendering of an ACP `requestedSchema` property —
// deliberately not shaped around Claude's `AskUserQuestion` tool specifically, so
// any ACP backend's form elicitation renders the same way (capability-driven, not
// a hardcoded per-backend shape).
export interface ElicitationField {
  key: string;
  title?: string;
  description?: string;
  kind: "select" | "multi-select" | "text";
  options?: Array<{ value: string; label: string; description?: string }>;
}

// ── ChatPatch — the streaming wire contract ──────────────────────────────

export type ChatPatch =
  | { type: "text-start"; index: number; content: string }
  | { type: "text-delta"; index: number; delta: string }
  | { type: "thought-start"; index: number; content: string }
  | { type: "thought-delta"; index: number; delta: string }
  | {
      type: "tool-call-start";
      index: number;
      toolCallId: string | null;
      toolName: string;
      argsInitial: string;
    }
  | { type: "tool-call-name-delta"; index: number; delta: string }
  | { type: "tool-call-args-delta"; index: number; delta: string }
  | {
      type: "tool-call-finalized";
      index: number;
      toolCallId: string | null;
      args: unknown;
      argsRaw?: string;
      intent?: string;
    }
  | { type: "tool-return"; toolCallId: string | null; content: unknown }
  | { type: "tool-error"; toolCallId: string | null; content: string }
  | { type: "tool-return-orphan"; toolName?: string; content: unknown }
  | { type: "usage"; usage: UsageTotals }
  | { type: "error"; message: string }
  | {
      type: "slash-commands";
      commands: Array<{ name: string; description?: string }>;
    }
  | {
      type: "approval-request";
      requestId: string;
      toolCallId: string | null;
      toolName: string;
      toolKind?: string;
      toolInput?: unknown;
      options: Array<{ id: string; name: string; kind?: string }>;
    }
  | {
      type: "elicitation-request";
      requestId: string;
      toolCallId: string | null;
      message: string;
      fields: ElicitationField[];
    }
  | { type: "steer-ack"; accepted: boolean; reason?: string }
  | {
      type: "images-skipped";
      skipped: Array<{
        filename?: string;
        mimeType: string;
        reason: "too-large" | "unsupported" | "decode-error";
      }>;
    };

// Subscription-level rate limit window, as reported by the Claude SDK's
// `rate_limit_event` (forwarded over ACP as `usage_update._meta["_claude/rateLimit"]`).
// Distinct from context_limit/context_used above, which describe the current
// turn's context window, not the account's five-hour/seven-day quota.
export interface RateLimitWindow {
  status: "allowed" | "allowed_warning" | "rejected";
  utilization?: number; // 0-1
  resetsAt?: number; // epoch ms
  // Human-readable reset time (e.g. "Jul 15 at 2pm (Asia/Calcutta)"), as
  // produced by `claude --print "/usage"` — used when there's no reliable way
  // to parse that free text into an exact epoch ms value (no year, named
  // timezone region). Prefer `resetsAt` when both are present.
  resetsAtText?: string;
}

export interface UsageTotals {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  context_limit?: number;
  context_used?: number;
  cost?: { amount: number; currency: string };
  thought_tokens?: number;
  // Keyed by the SDK's rateLimitType (e.g. "five_hour", "seven_day").
  rate_limits?: Record<string, RateLimitWindow>;
}

// ── Factory config (consumed by createAgentBackend) ──────────────────────

export interface AgentBackendConfig {
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  model?: string;
  kind?: string;
}