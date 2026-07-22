import { useMemo, useRef } from "react";
import { Markdown } from "../markdown";
import type { ChatPatch, UsageTotals } from "../api/types";
import { Pill } from "./ui/Pill";
import { Dot, type DotStatus } from "./ui/Dot";
import { JsonView } from "./ui/JsonView";
import styles from "./Timeline.module.css";

export interface TimelineProps {
  patches: ChatPatch[];
  backendKind?: string | null;
  onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
  onElicitation?: (p: ChatPatch & { type: "elicitation-request" }) => void;
  onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
}

type Bubble =
  | { kind: "text"; content: string }
  | { kind: "thought"; content: string }
  | { kind: "tool"; toolName: string; argsText: string; argsRaw?: unknown; result?: { ok: boolean; text: string; raw?: unknown }; meta?: Record<string, unknown> };

interface TimelineState {
  bubbles: Bubble[];
  usage?: UsageTotals;
  error?: string;
}

function buildTimelineState(
  patches: ChatPatch[],
  emit: {
    onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
    onElicitation?: (p: ChatPatch & { type: "elicitation-request" }) => void;
    onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
    onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
  },
  // buildTimelineState re-walks the whole patches array from scratch on every
  // recompute (each streamed delta grows the array), so without this guard
  // every side-effecting patch (approval/elicitation/steer-ack/images-skipped)
  // would re-fire its callback on every later patch in the same turn — e.g.
  // reopening an already-answered elicitation modal once the tool result or
  // trailing assistant text streams in. Keyed by patch object identity, which
  // is stable across recomputes since historical patches are never mutated or
  // recreated, only appended to.
  emitted: Set<ChatPatch>,
): TimelineState {
  const bubbles: Bubble[] = [];
  let usage: UsageTotals | undefined;
  let error: string | undefined;
  let currentText: string | null = null;
  const toolsByCallId = new Map<string, number>();

  for (const p of patches) {
    switch (p.type) {
      case "text-start":
        currentText = p.content || "";
        bubbles.push({ kind: "text", content: currentText });
        break;
      case "text-delta":
        if (currentText !== null) {
          currentText += p.delta || "";
          const last = bubbles[bubbles.length - 1];
          if (last && last.kind === "text") last.content = currentText;
        } else {
          currentText = p.delta || "";
          bubbles.push({ kind: "text", content: currentText });
        }
        break;
      case "thought-start":
        bubbles.push({ kind: "thought", content: p.content || "" });
        break;
      case "thought-delta": {
        const last = bubbles[bubbles.length - 1];
        if (last && last.kind === "thought") last.content += p.delta || "";
        else bubbles.push({ kind: "thought", content: p.delta || "" });
        break;
      }
      case "tool-call-start": {
        const args = p.argsInitial || "";
        bubbles.push({ kind: "tool", toolName: p.toolName, argsText: args, meta: p.meta });
        if (p.toolCallId) toolsByCallId.set(p.toolCallId, bubbles.length - 1);
        currentText = null;
        break;
      }
      case "tool-call-finalized": {
        const idx = p.toolCallId ? toolsByCallId.get(p.toolCallId) : undefined;
        const target = idx !== undefined ? bubbles[idx] : bubbles[bubbles.length - 1];
        if (target && target.kind === "tool") {
          target.argsText = p.args !== undefined
            ? JSON.stringify(p.args, null, 2)
            : (p.argsRaw ?? target.argsText);
          if (p.args !== undefined) target.argsRaw = p.args;
          if (p.intent) target.toolName = p.intent;
          if (p.meta) target.meta = { ...target.meta, ...p.meta };
        }
        break;
      }
      case "tool-return":
      case "tool-error": {
        const idx = p.toolCallId ? toolsByCallId.get(p.toolCallId) : undefined;
        const target = idx !== undefined ? bubbles[idx] : bubbles[bubbles.length - 1];
        if (target && target.kind === "tool") {
          target.result = {
            ok: p.type === "tool-return",
            text: typeof p.content === "string" ? p.content : JSON.stringify(p.content, null, 2),
            raw: p.content,
          };
        }
        break;
      }
      case "tool-return-orphan":
        bubbles.push({
          kind: "tool",
          toolName: p.toolName || "return",
          argsText: "",
          result: {
            ok: true,
            text: typeof p.content === "string" ? p.content : JSON.stringify(p.content, null, 2),
            raw: p.content,
          },
        });
        break;
      case "usage":
        usage = p.usage;
        break;
      case "error":
        error = p.message;
        break;
      case "approval-request":
        if (!emitted.has(p)) {
          emitted.add(p);
          emit.onApproval?.(p);
        }
        break;
      case "elicitation-request":
        if (!emitted.has(p)) {
          emitted.add(p);
          emit.onElicitation?.(p);
        }
        break;
      case "steer-ack":
        if (!emitted.has(p)) {
          emitted.add(p);
          emit.onSteerAck?.(p);
        }
        break;
      case "images-skipped":
        if (!emitted.has(p)) {
          emitted.add(p);
          emit.onImagesSkipped?.(p);
        }
        break;
      default:
        break;
    }
  }
  return { bubbles, usage, error };
}

function renderBubble(b: Bubble, key: number, _backendKind?: string | null): JSX.Element {
  switch (b.kind) {
    case "text":
      return <div key={key} className={styles.text}><Markdown source={b.content} /></div>;
    case "thought":
      return (
        <details key={key} className={styles.thought} open>
          <summary>Thinking…</summary>
          <div>{b.content}</div>
        </details>
      );
    case "tool": {
      const status: DotStatus = !b.result ? "progress" : b.result.ok ? "ok" : "bad";
      const argsContent = b.argsRaw !== undefined ? b.argsRaw : (b.argsText || null);
      return (
        <details key={key} className={styles.tool}>
          <summary>
            <Dot status={status} />
            <span className={styles.toolName}>{b.toolName}</span>
          </summary>
          {argsContent !== null && <JsonView content={argsContent} maxHeight={240} />}
          {b.result && (
            <div className={styles.toolResult}>
              <span className={b.result.ok ? styles.ok : styles.err}>
                {b.result.ok ? "ok" : "error"}
              </span>
              <JsonView content={b.result.raw ?? b.result.text} maxHeight={320} copyButton />
            </div>
          )}
        </details>
      );
    }
  }
}

function usagePills(u: UsageTotals): string[] {
  const out: string[] = [];
  if (u.input_tokens) out.push("in " + u.input_tokens);
  if (u.output_tokens) out.push("out " + u.output_tokens);
  if (u.thought_tokens) out.push("think " + u.thought_tokens);
  if (u.cache_read_tokens) out.push("cache " + u.cache_read_tokens);
  return out;
}

export function Timeline({ patches, backendKind, onApproval, onElicitation, onSteerAck, onImagesSkipped }: TimelineProps) {
  const emittedRef = useRef<Set<ChatPatch>>(new Set());
  const state = useMemo(
    () => buildTimelineState(patches, { onApproval, onElicitation, onSteerAck, onImagesSkipped }, emittedRef.current),
    [patches, onApproval, onElicitation, onSteerAck, onImagesSkipped],
  );
  return (
    <div className={styles.timeline}>
      {state.bubbles.map((b, i) => renderBubble(b, i, backendKind))}
      {state.usage && (
        <div className={styles.usage}>
          {usagePills(state.usage).map((s, i) => <Pill key={i} tone="neutral">{s}</Pill>)}
        </div>
      )}
      {state.error && <div className={styles.errorMsg}>{state.error}</div>}
    </div>
  );
}
