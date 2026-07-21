import { useMemo, useRef } from "react";
import { Markdown } from "../markdown";
import type { ChatPatch, UsageTotals } from "../api/types";
import { Pill } from "./ui/Pill";
import styles from "./Timeline.module.css";

export interface TimelineProps {
  patches: ChatPatch[];
  onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
  onElicitation?: (p: ChatPatch & { type: "elicitation-request" }) => void;
  onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
}

type Bubble =
  | { kind: "text"; content: string }
  | { kind: "thought"; content: string }
  | { kind: "tool"; toolName: string; argsText: string; result?: { ok: boolean; text: string } };

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
        bubbles.push({ kind: "tool", toolName: p.toolName, argsText: args });
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
          if (p.intent) target.toolName = p.intent;
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

function renderBubble(b: Bubble, key: number): JSX.Element {
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
      const status = !b.result ? "in-progress" : b.result.ok ? "success" : "fail";
      const toolClass = status === "in-progress"
        ? `${styles.tool} ${styles.toolInProgress}`
        : status === "success"
        ? `${styles.tool} ${styles.toolSuccess}`
        : `${styles.tool} ${styles.toolError}`;
      return (
        <details key={key} className={toolClass}>
          <summary>
            {b.toolName}
            {status === "in-progress" && <span className={styles.spinner} />}
          </summary>
          {b.argsText && <pre className={styles.toolArgs}>{b.argsText}</pre>}
          {b.result && (
            <div className={styles.toolResult}>
              <span className={b.result.ok ? styles.ok : styles.err}>
                {b.result.ok ? "ok" : "error"}
              </span>{" "}
              {b.result.text}
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

export function Timeline({ patches, onApproval, onElicitation, onSteerAck, onImagesSkipped }: TimelineProps) {
  const emittedRef = useRef<Set<ChatPatch>>(new Set());
  const state = useMemo(
    () => buildTimelineState(patches, { onApproval, onElicitation, onSteerAck, onImagesSkipped }, emittedRef.current),
    [patches, onApproval, onElicitation, onSteerAck, onImagesSkipped],
  );
  return (
    <div className={styles.timeline}>
      {state.bubbles.map((b, i) => renderBubble(b, i))}
      {state.usage && (
        <div className={styles.usage}>
          {usagePills(state.usage).map((s, i) => <Pill key={i} tone="neutral">{s}</Pill>)}
        </div>
      )}
      {state.error && <div className={styles.errorMsg}>{state.error}</div>}
    </div>
  );
}
