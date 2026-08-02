import { useLayoutEffect, useRef } from "react";
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
  onDismissQueued?: (queueId: string) => void;
}

export function Transcript(props: TranscriptProps) {
  const { scrollRef, showTop, showBottom, scrollToTop, scrollToBottom } = useScrollButtons();
  const follow = props.follow ?? true;
  // showBottom reflects the position from the last real scroll event, i.e.
  // where the user was sitting *before* this render's new entries landed —
  // exactly what we need to decide whether to stick to the new bottom.
  const isAtBottom = !showBottom;
  // isAtBottom is derived from the previous content's scroll position and
  // can be stale across a chat switch (e.g. the user had scrolled up in the
  // old chat) — without this, the first population of a loaded chat bails on
  // the stale "not at bottom" gate and opens at the top. On first population
  // we settle at the bottom regardless; live updates after that keep the
  // "don't yank the user" gate.
  const hasLoadedRef = useRef(false);
  useLayoutEffect(() => {
    if (!follow || !scrollRef.current) return;
    if (props.entries.length === 0) {
      hasLoadedRef.current = false;
      return;
    }
    // While the loading placeholder is still rendered the scroll container
    // has no real content — don't consume the first-population scroll yet.
    // History can land while loading is still true (init also awaits a
    // separate /chat/groups fetch), so the real content mounts only after
    // loading flips false; scrolling now would be a no-op against the short
    // placeholder and the loaded chat would open at the top.
    if (props.loading) return;
    const firstPopulation = !hasLoadedRef.current;
    hasLoadedRef.current = true;
    if (!firstPopulation && !isAtBottom) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    const raf = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [props.entries, follow, isAtBottom, scrollRef, props.loading]);
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
            onDismissQueued={props.onDismissQueued}
          />
        ))}
      </div>
      <ScrollButtons showTop={showTop} showBottom={showBottom} onScrollToTop={scrollToTop} onScrollToBottom={scrollToBottom} />
    </div>
  );
}
