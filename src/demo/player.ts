// Plays one scripted demo response as ACP agent traffic: `session/update`
// notifications for text and tool calls, plus a form-mode
// `elicitation/create` request for ask-user tools (which surfaces the
// gateway's question dialog). Transport-agnostic — the mock agent supplies
// the I/O, tests can supply a recorder.

import {
  askUserQuestions,
  isAskUserToolName,
  type DemoQuestion,
  type DemoResponse,
  type DemoTextPart,
  type DemoTiming,
  type DemoToolCallPart,
} from "./config";

export type AcpUpdateBody = Record<string, unknown> & { sessionUpdate: string };

export interface PlayerIO {
  // Emit one `session/update` notification body for the current session.
  sendUpdate(update: AcpUpdateBody): void;
  // Send an agent→client JSON-RPC request and resolve with its result.
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface PlayOptions {
  io: PlayerIO;
  timing: DemoTiming;
  // Aborted by `session/cancel`; playback stops at the next step.
  signal: AbortSignal;
  newToolCallId(): string;
}

export class PlaybackCancelledError extends Error {
  constructor() {
    super("playback cancelled");
    this.name = "PlaybackCancelledError";
  }
}

export async function playResponse(response: DemoResponse, opts: PlayOptions): Promise<void> {
  await sleep(opts.timing.responseDelayMs, opts.signal);
  let previous: DemoResponse["parts"][number] | null = null;
  for (const part of response.parts) {
    await sleep(part.delayMs ?? 0, opts.signal);
    if (part.type === "text") {
      // Back-to-back text parts stream into the same message bubble; keep
      // them visually separate paragraphs instead of gluing them together.
      await playText(part, previous?.type === "text" ? "\n\n" : "", opts);
    } else {
      await playToolCall(part, opts);
    }
    previous = part;
  }
}

// Plain text reply, streamed a few words at a time so it looks like a live
// agent. Chunks concatenate back to the exact configured text.
export function chunkText(text: string, wordsPerChunk = 3): string[] {
  const tokens = text.match(/\s+|\S+\s*/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += wordsPerChunk) {
    out.push(tokens.slice(i, i + wordsPerChunk).join(""));
  }
  return out;
}

async function playText(part: DemoTextPart, prefix: string, opts: PlayOptions): Promise<void> {
  const text = prefix + part.text;
  if (text === "") return;
  const chunks = opts.timing.textChunkDelayMs > 0 ? chunkText(text) : [text];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(opts.timing.textChunkDelayMs, opts.signal);
    opts.io.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunks[i] } });
  }
}

async function playToolCall(part: DemoToolCallPart, opts: PlayOptions): Promise<void> {
  const toolCallId = opts.newToolCallId();
  opts.io.sendUpdate({
    sessionUpdate: "tool_call",
    toolCallId,
    title: part.title ?? part.name,
    kind: part.kind ?? "other",
    status: "pending",
    rawInput: part.input ?? {},
    _meta: { demo: { toolName: part.name } },
  });
  try {
    if (isAskUserToolName(part.name)) {
      await askUser(part, toolCallId, opts);
      return;
    }
    opts.io.sendUpdate({ sessionUpdate: "tool_call_update", toolCallId, status: "in_progress" });
    await sleep(part.durationMs ?? opts.timing.toolCallDurationMs, opts.signal);
    if (part.status === "failed") {
      opts.io.sendUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        content: [{ type: "text", text: part.error ?? "tool call failed" }],
        ...(part.output !== undefined ? { rawOutput: part.output } : {}),
      });
    } else {
      opts.io.sendUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        rawOutput: part.output ?? "",
      });
    }
  } catch (err) {
    if (err instanceof PlaybackCancelledError) {
      // Don't leave the bubble spinning forever on Stop.
      opts.io.sendUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        content: [{ type: "text", text: "Cancelled" }],
      });
    }
    throw err;
  }
}

// ── Ask-user tool → form elicitation ─────────────────────────────────────

async function askUser(part: DemoToolCallPart, toolCallId: string, opts: PlayOptions): Promise<void> {
  const questions = askUserQuestions(part);
  const request = buildQuestionElicitation(questions);
  const result = await raceAbort(
    opts.io.request("elicitation/create", { mode: "form", toolCallId, ...request }),
    opts.signal,
  );
  opts.io.sendUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: "completed",
    rawOutput: summarizeAnswers(questions, result),
  });
}

type ElicitationProperty = Record<string, unknown>;

// Same schema shape the Claude ACP adapter sends for AskUserQuestion (see
// docs/agent-claude-code.md §7): `question_<i>` holds the choice(s), and
// `question_<i>_custom` is a free-text "Other" answer for questions with options.
export function buildQuestionElicitation(questions: DemoQuestion[]): {
  message: string;
  requestedSchema: { type: "object"; properties: Record<string, ElicitationProperty> };
} {
  const single = questions.length === 1;
  const properties: Record<string, ElicitationProperty> = {};
  questions.forEach((q, i) => {
    const key = `question_${i}`;
    const options = q.options ?? [];
    const label = { title: q.header, description: single ? undefined : q.question };
    if (options.length === 0) {
      properties[key] = { type: "string", ...label };
      return;
    }
    const choices = options.map((o) => ({ const: o.label, title: o.label, description: o.description }));
    properties[key] = q.multiSelect
      ? { type: "array", ...label, items: { anyOf: choices } }
      : { type: "string", ...label, oneOf: choices };
    properties[`${key}_custom`] = { type: "string", title: "Other", description: "Type your own answer" };
  });
  return {
    message: single ? questions[0].question : "Please answer the following questions",
    requestedSchema: { type: "object", properties },
  };
}

// Tool result shown in the ask-user tool bubble once the dialog closes.
export function summarizeAnswers(questions: DemoQuestion[], result: unknown): unknown {
  const r = (result ?? {}) as { action?: string; content?: Record<string, unknown> };
  if (r.action !== "accept") {
    return r.action === "decline" ? "User skipped the question." : "Question dismissed.";
  }
  const content = r.content ?? {};
  const answers: Record<string, string> = {};
  questions.forEach((q, i) => {
    const picked = content[`question_${i}`];
    const custom = content[`question_${i}_custom`];
    const values = [
      ...(Array.isArray(picked) ? picked : picked !== undefined ? [picked] : []),
      ...(typeof custom === "string" && custom.trim() !== "" ? [custom.trim()] : []),
    ].map(String);
    answers[q.question] = values.length > 0 ? values.join(", ") : "(no answer)";
  });
  return { answers };
}

// ── Cancellation-aware waiting ───────────────────────────────────────────

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new PlaybackCancelledError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new PlaybackCancelledError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new PlaybackCancelledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new PlaybackCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
