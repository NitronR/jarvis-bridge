import { useEffect, useLayoutEffect } from "react";
import { Message, type MessageEntry } from "./Message";
import type { ChatPatch } from "../api/types";
import { useScrollButtons } from "../hooks/useScrollButtons";
import { ScrollButtons } from "./ScrollButtons";
import styles from "./Transcript.module.css";

export interface TranscriptProps {
  entries: MessageEntry[];
  loading?: boolean;
  follow?: boolean;
  backendKind?: string | null;
  onApproval: (p: ChatPatch & { type: "approval-request" }) => void;
  onElicitation: (p: ChatPatch & { type: "elicitation-request" }) => void;
  onSteerAck: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped: (p: ChatPatch & { type: "images-skipped" }) => void;
}

export function Transcript(props: TranscriptProps) {
  const { scrollRef, showTop, showBottom, scrollToTop, scrollToBottom } = useScrollButtons();
  const follow = props.follow ?? true;
  useLayoutEffect(() => {
    if (!follow || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    const raf = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [props.entries, follow, scrollRef]);
  if (props.loading) {
    return (
      <div className={styles.transcriptWrap}>
        <div ref={scrollRef} className={styles.transcript}>
          <div className={styles.empty}>
            <p>Loading…</p>
          </div>
        </div>
        <ScrollButtons showTop={showTop} showBottom={showBottom} onScrollToTop={scrollToTop} onScrollToBottom={scrollToBottom} />
      </div>
    );
  }
  if (props.entries.length === 0) {
    return (
      <div className={styles.transcriptWrap}>
        <div ref={scrollRef} className={styles.transcript}>
          <div className={styles.empty}>
            <h2>Start a conversation</h2>
            <p>Send a message to begin.</p>
          </div>
        </div>
        <ScrollButtons showTop={showTop} showBottom={showBottom} onScrollToTop={scrollToTop} onScrollToBottom={scrollToBottom} />
      </div>
    );
  }
  return (
    <div className={styles.transcriptWrap}>
      <div ref={scrollRef} className={styles.transcript} role="log" aria-live="polite">
        {props.entries.map((entry, idx) => (
          <Message
            key={idx}
            entry={entry}
            showAvatar={idx === 0 || props.entries[idx - 1].role !== entry.role}
            backendKind={props.backendKind}
            onApproval={props.onApproval}
            onElicitation={props.onElicitation}
            onSteerAck={props.onSteerAck}
            onImagesSkipped={props.onImagesSkipped}
          />
        ))}
      </div>
      <ScrollButtons showTop={showTop} showBottom={showBottom} onScrollToTop={scrollToTop} onScrollToBottom={scrollToBottom} />
    </div>
  );
}
