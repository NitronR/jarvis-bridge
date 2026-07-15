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
}

export interface SendMessageOptions {
  signal?: AbortSignal;
  images?: PromptImageAttachment[];
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