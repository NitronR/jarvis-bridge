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
  getSessionModels?(sessionId: string): SessionModelsInfo | null;
  setSessionModel?(sessionId: string, modelId: string): Promise<void>;

  shutdown(): Promise<void>;
}

export interface PromptImageAttachment {
  data: string;
  mimeType: string;
  filename?: string;
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
  | { type: "steer-ack"; accepted: boolean; reason?: string }
  | {
      type: "images-skipped";
      skipped: Array<{
        filename?: string;
        mimeType: string;
        reason: "too-large" | "unsupported" | "decode-error";
      }>;
    };

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
}

// ── Factory config (consumed by createAgentBackend) ──────────────────────

export interface AgentBackendConfig {
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  model?: string;
}