// Translate ACP `session/update` notifications into the backend-agnostic
// `ChatPatch` stream consumed by the rest of the gateway.

import type { ChatPatch, UsageTotals } from "../types.js";

export interface AcpUpdate {
  sessionUpdate: string;
  // content is used by agent_message_chunk / agent_thought_chunk /
  // user_message_chunk and (in some agents) the failing tool_call_update body.
  content?: AcpContent | AcpContent[];
  // tool_call notifications carry the toolCallId + an optional toolCall envelope
  toolCallId?: string;
  toolCall?: {
    toolCallId: string;
    title?: string;
    kind?: string;
    rawInput?: unknown;
    input?: unknown;
  };
  // tool_call_update
  status?: "pending" | "in_progress" | "completed" | "failed";
  rawInput?: unknown;
  rawOutput?: unknown;
  // usage_update
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  thoughtTokens?: number;
  contextLimit?: number;
  contextUsed?: number;
  // available_commands_update
  availableCommands?: Array<{ name: string; description?: string }>;
  // session/prompt final result
  stopReason?: string;
  usage?: Record<string, unknown>;
}

export interface AcpContent {
  type: string;
  text?: string;
}

export interface AcpStreamState {
  nextIndex: number;
  streamingTextIndex: number | null;
  streamingThoughtIndex: number | null;
  toolCallIndexById: Map<string, number>;
  finalizedToolCalls: Set<string>;
  usage: UsageTotals;
  // Slash commands are advertised per-session and persist across turns.
  slashCommands: Array<{ name: string; description?: string }>;
}

export function resetTurnState(state: AcpStreamState): AcpStreamState {
  state.nextIndex = 0;
  state.streamingTextIndex = null;
  state.streamingThoughtIndex = null;
  state.toolCallIndexById = new Map();
  state.finalizedToolCalls = new Set();
  state.usage = {
    requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
  // intentionally preserve state.slashCommands
  return state;
}

function extractText(content: AcpContent | AcpContent[] | undefined): string {
  if (!content) return "";
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c.text === "string" ? c.text : ""))
      .join("");
  }
  return typeof content.text === "string" ? content.text : "";
}

function extractToolInput(update: AcpUpdate): unknown {
  if (update.rawInput !== undefined) return update.rawInput;
  if (update.toolCall?.rawInput !== undefined) return update.toolCall.rawInput;
  if (update.toolCall?.input !== undefined) return update.toolCall.input;
  return undefined;
}

function toolNameFromUpdate(update: AcpUpdate): string {
  return update.toolCall?.title ?? update.toolCall?.kind ?? "tool";
}

export function acpUpdateToPatches(
  update: AcpUpdate,
  state: AcpStreamState,
): ChatPatch[] {
  const out: ChatPatch[] = [];

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      // Close any open thought block; text takes precedence.
      state.streamingThoughtIndex = null;
      const text = extractText(update.content);
      if (state.streamingTextIndex === null) {
        const idx = state.nextIndex++;
        state.streamingTextIndex = idx;
        out.push({ type: "text-start", index: idx, content: text });
      } else {
        out.push({
          type: "text-delta",
          index: state.streamingTextIndex,
          delta: text,
        });
      }
      break;
    }

    case "agent_thought_chunk": {
      // Close any open text block; thought takes precedence on its channel.
      state.streamingTextIndex = null;
      const text = extractText(update.content);
      if (state.streamingThoughtIndex === null) {
        const idx = state.nextIndex++;
        state.streamingThoughtIndex = idx;
        out.push({ type: "thought-start", index: idx, content: text });
      } else {
        out.push({
          type: "thought-delta",
          index: state.streamingThoughtIndex,
          delta: text,
        });
      }
      break;
    }

    case "user_message_chunk": {
      // Not surfaced to the UI; just close any open text/thought.
      state.streamingTextIndex = null;
      state.streamingThoughtIndex = null;
      break;
    }

    case "tool_call": {
      const toolCallId = update.toolCallId ?? update.toolCall?.toolCallId ?? null;
      const toolName = toolNameFromUpdate(update);
      const idx = state.nextIndex++;
      state.toolCallIndexById.set(toolCallId ?? `idx-${idx}`, idx);
      out.push({
        type: "tool-call-start",
        index: idx,
        toolCallId,
        toolName,
        argsInitial: "",
      });
      const finalArgs = extractToolInput(update);
      if (finalArgs !== undefined) {
        out.push({
          type: "tool-call-finalized",
          index: idx,
          toolCallId,
          args: finalArgs,
        });
        state.finalizedToolCalls.add(toolCallId ?? `idx-${idx}`);
      }
      break;
    }

    case "tool_call_update": {
      const toolCallId = update.toolCallId ?? null;
      const key = toolCallId ?? "";
      const idx = state.toolCallIndexById.get(key);
      const finalArgs = extractToolInput(update);
      // Emit tool-call-finalized exactly once, on whichever notification first
      // carries the rawInput.
      if (finalArgs !== undefined && !state.finalizedToolCalls.has(key)) {
        if (idx !== undefined) {
          out.push({
            type: "tool-call-finalized",
            index: idx,
            toolCallId,
            args: finalArgs,
          });
          state.finalizedToolCalls.add(key);
        }
      }
      const status = update.status;
      if (status === "completed") {
        const content = update.rawOutput ?? extractText(update.content);
        out.push({ type: "tool-return", toolCallId, content });
      } else if (status === "failed") {
        const content = extractText(update.content) || "tool call failed";
        out.push({ type: "tool-error", toolCallId, content });
      }
      // in_progress / pending: no patches
      break;
    }

    case "usage_update": {
      const u = usageFromAcp(update);
      if (u) {
        state.usage = mergeUsage(state.usage, u);
        out.push({ type: "usage", usage: { ...state.usage } });
      }
      break;
    }

    case "available_commands_update": {
      const commands = (update.availableCommands ?? []).map((c) => ({
        name: c.name.replace(/^\//, ""),
        description: c.description,
      }));
      state.slashCommands = commands;
      out.push({ type: "slash-commands", commands });
      break;
    }

    default:
      // current_mode_update, session_info_update, config_option_update, etc.
      break;
  }

  return out;
}

// ── Usage normalization ──────────────────────────────────────────────────

interface AcpUsageShape {
  inputTokens?: number;
  input_tokens?: number;
  outputTokens?: number;
  output_tokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  contextLimit?: number;
  context_limit?: number;
  size?: number;
  used?: number;
  contextUsed?: number;
  context_used?: number;
  cost?: { amount: number; currency: string };
  thoughtTokens?: number;
  thought_tokens?: number;
}

export function usageFromAcp(value: AcpUsageShape | null | undefined): UsageTotals | null {
  if (!value) return null;
  const input =
    value.inputTokens ?? value.input_tokens ?? 0;
  const output =
    value.outputTokens ?? value.output_tokens ?? 0;
  const cacheRead =
    value.cachedReadTokens ?? value.cache_read_tokens ?? 0;
  const cacheWrite =
    value.cachedWriteTokens ?? value.cache_write_tokens ?? 0;
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
    return null;
  }
  const out: UsageTotals = {
    requests: 0,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
  };
  const limit = value.contextLimit ?? value.context_limit ?? value.size;
  if (typeof limit === "number") out.context_limit = limit;
  const used = value.used ?? value.contextUsed ?? value.context_used;
  if (typeof used === "number") out.context_used = used;
  if (value.cost) out.cost = value.cost;
  const thought = value.thoughtTokens ?? value.thought_tokens;
  if (typeof thought === "number") out.thought_tokens = thought;
  return out;
}

export function mergeUsage(current: UsageTotals, incoming: UsageTotals): UsageTotals {
  return {
    ...current,
    requests: (current.requests ?? 0) + (incoming.requests ?? 0),
    input_tokens: current.input_tokens + incoming.input_tokens,
    output_tokens: current.output_tokens + incoming.output_tokens,
    cache_read_tokens: current.cache_read_tokens + incoming.cache_read_tokens,
    cache_write_tokens: current.cache_write_tokens + incoming.cache_write_tokens,
    context_limit: incoming.context_limit ?? current.context_limit,
    context_used: incoming.context_used ?? current.context_used,
    cost: incoming.cost ?? current.cost,
    thought_tokens: incoming.thought_tokens ?? current.thought_tokens,
  };
}

// ── Final result from session/prompt ─────────────────────────────────────

export function patchFromPromptResult(
  result: { usage?: Record<string, unknown>; _meta?: Record<string, unknown> } | null | undefined,
  state: AcpStreamState,
): ChatPatch | null {
  const u = usageFromAcp(result?.usage as AcpUsageShape | undefined);
  let totals = u;
  if (!totals) {
    // Try meta window tokens
    const meta = result?._meta;
    if (meta && typeof meta === "object") {
      totals = usageFromAcp(meta as unknown as AcpUsageShape);
    }
  }
  if (!totals) return null;
  state.usage = mergeUsage(state.usage, totals);
  return { type: "usage", usage: { ...state.usage } };
}