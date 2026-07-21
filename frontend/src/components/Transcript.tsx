import { useEffect, useRef } from "react";
import { Message, type MessageEntry } from "./Message";
import type { ChatPatch } from "../api/types";
import styles from "./Transcript.module.css";

export interface TranscriptProps {
  entries: MessageEntry[];
  loading?: boolean;
  follow?: boolean;
  onApproval: (p: ChatPatch & { type: "approval-request" }) => void;
  onElicitation: (p: ChatPatch & { type: "elicitation-request" }) => void;
  onSteerAck: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped: (p: ChatPatch & { type: "images-skipped" }) => void;
}

export function Transcript(props: TranscriptProps) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = props.follow ?? true;
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [props.entries, follow]);
  if (props.loading) {
    return (
      <div ref={ref} className={styles.transcript}>
        <div className={styles.empty}>
          <p>Loading…</p>
        </div>
      </div>
    );
  }
  if (props.entries.length === 0) {
    return (
      <div ref={ref} className={styles.transcript}>
        <div className={styles.empty}>
          <h2>Start a conversation</h2>
          <p>Send a message to begin.</p>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className={styles.transcript} role="log" aria-live="polite">
      {props.entries.map((entry, idx) => (
        <Message
          key={idx}
          entry={entry}
          showAvatar={idx === 0 || props.entries[idx - 1].role !== entry.role}
          onApproval={props.onApproval}
          onElicitation={props.onElicitation}
          onSteerAck={props.onSteerAck}
          onImagesSkipped={props.onImagesSkipped}
        />
      ))}
    </div>
  );
}
