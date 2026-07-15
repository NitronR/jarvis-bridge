import { useRef, useState, type FormEvent } from "react";
import type { ImageAttachment, UsageTotals } from "../api/types";
import { loadQuickPhrases, saveQuickPhrases } from "../state/quickPhrases";
import { QuickPhrasesRow } from "./QuickPhrasesRow";
import styles from "./Composer.module.css";

export interface ComposerProps {
  busy: boolean;
  steerEnabled: boolean;
  steerSupported: boolean;
  imagesSupported: boolean;
  attachments: ImageAttachment[];
  latestUsage?: UsageTotals;
  onRemoveAttachment: (idx: number) => void;
  onAttachFiles: (files: File[]) => void;
  onSend: (text: string) => void;
  onSteer: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onQueue: (text: string) => Promise<void>;
  onToggleSteer: () => void;
}

export function Composer(props: ComposerProps) {
  const {
    busy, steerEnabled, steerSupported, imagesSupported,
    attachments, latestUsage,
    onRemoveAttachment, onAttachFiles,
    onSend, onSteer, onCancel, onQueue, onToggleSteer,
  } = props;
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [phrases, setPhrases] = useState<string[]>(() => loadQuickPhrases());

  const dispatch = (trimmed: string) => {
    if (steerEnabled) void onSteer(trimmed);
    else if (busy) void onQueue(trimmed);
    else onSend(trimmed);
  };

  const submitPhrase = (phrase: string) => {
    dispatch(phrase.trim());
    textareaRef.current?.focus();
  };

  const addPhrase = (phrase: string) => {
    setPhrases((prev) => {
      const next = [...prev, phrase];
      saveQuickPhrases(next);
      return next;
    });
  };

  const deletePhrase = (idx: number) => {
    setPhrases((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      saveQuickPhrases(next);
      return next;
    });
  };

  const submit = (ev?: FormEvent) => {
    if (ev) ev.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    dispatch(trimmed);
    setText("");
  };

  return (
    <form className={styles.form} onSubmit={submit} autoComplete="off">
      <div className={styles.attachments}>
        {attachments.map((img, idx) => (
          <div key={idx} className={styles.attachment}>
            <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.filename || "image"} />
            <span>{img.filename || `image ${idx + 1}`}</span>
            <button type="button" onClick={() => onRemoveAttachment(idx)} aria-label="remove">×</button>
          </div>
        ))}
      </div>
      <QuickPhrasesRow phrases={phrases} onSubmit={submitPhrase} onAdd={addPhrase} onDelete={deletePhrase} />
      <div className={styles.row}>
        <textarea
          ref={textareaRef}
          rows={2}
          placeholder={
            steerEnabled
              ? "Steer the running turn…"
              : busy
                ? "Queue a message for after this turn… (Enter to queue)"
                : "Type a message… (Shift+Enter for newline, Enter to send)"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            onAttachFiles(files);
            e.target.value = "";
          }}
        />
        <div className={styles.actions}>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!imagesSupported} title="Attach image">📎</button>
          {busy ? (
            <button type="button" className="danger" onClick={() => void onCancel()}>Stop</button>
          ) : (
            <button type="submit" className="primary">Send</button>
          )}
          {busy && <button type="button" onClick={() => void onQueue(text)} disabled={!text.trim()}>Queue</button>}
          {steerSupported && (
            <button type="button" className={steerEnabled ? "primary" : ""} onClick={onToggleSteer}>Steer</button>
          )}
        </div>
      </div>
      {latestUsage && latestUsage.context_limit != null && latestUsage.context_limit > 0 && (
        <div className={styles.contextBar}>
          <span>
            Context: {latestUsage.context_used?.toLocaleString() ?? "0"} /{" "}
            {latestUsage.context_limit.toLocaleString()}
            {" ("}
            <span className={latestUsage.context_used != null && latestUsage.context_used / latestUsage.context_limit > 0.8 ? styles.warn : undefined}>
              {latestUsage.context_used != null
                ? Math.round((latestUsage.context_used / latestUsage.context_limit) * 100)
                : 0}
              %
            </span>
            {")"}
          </span>
          {latestUsage.cost && (
            <span> · ${latestUsage.cost.amount.toFixed(2)}</span>
          )}
        </div>
      )}
    </form>
  );
}
