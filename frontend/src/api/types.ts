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

export interface SlashCommand { name: string; description?: string; }
export interface ModelInfo { modelId: string; name: string; }
export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt?: string | null;
  cwd?: string;
  customTitle?: string;
  pinned?: boolean;
  group?: string;
  active?: boolean;
}

export interface AutoApproveState {
  supported: boolean;
  default: boolean;
  override: boolean | null;
  effective: boolean;
  enabled: boolean;
}

export interface ChatInitResponse {
  ok: true;
  backend: { kind: string; role: string; model: string | null };
  sessionId: string;
  cwd: string;
  resumed: boolean;
  capabilities: AgentCapabilities;
  slashCommands: SlashCommand[];
  history: ChatHistoryEntry[];
  autoApprove: AutoApproveState;
  model: { supported: boolean; available: ModelInfo[]; current: string | null };
}

export type ChatHistoryEntry =
  | { kind: "user"; content: string }
  | { kind: "assistant"; patches: ChatPatch[] };

export type ChatPatch =
  | { type: "text-start"; index: number; content: string }
  | { type: "text-delta"; index: number; delta: string }
  | { type: "thought-start"; index: number; content: string }
  | { type: "thought-delta"; index: number; delta: string }
  | { type: "tool-call-start"; index: number; toolCallId: string | null; toolName: string; argsInitial: string }
  | { type: "tool-call-name-delta"; index: number; delta: string }
  | { type: "tool-call-args-delta"; index: number; delta: string }
  | { type: "tool-call-finalized"; index: number; toolCallId: string | null; args: unknown; argsRaw?: string; intent?: string }
  | { type: "tool-return"; toolCallId: string | null; content: unknown }
  | { type: "tool-error"; toolCallId: string | null; content: string }
  | { type: "tool-return-orphan"; toolName?: string; content: unknown }
  | { type: "usage"; usage: UsageTotals }
  | { type: "error"; message: string }
  | { type: "slash-commands"; commands: SlashCommand[] }
  | { type: "approval-request"; requestId: string; toolCallId: string | null; toolName: string; toolKind?: string; toolInput?: unknown; options: Array<{ id: string; name?: string; kind?: string }> }
  | { type: "steer-ack"; accepted: boolean; reason?: string }
  | { type: "images-skipped"; skipped: Array<{ filename?: string; mimeType: string; reason: "too-large" | "unsupported" | "decode-error" }> }
  | { type: "done" };

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

export interface ImageAttachment {
  data: string;
  mimeType: string;
  filename?: string;
}