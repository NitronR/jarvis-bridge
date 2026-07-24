import { useLayoutEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { ImageAttachment, ModelInfo, UsageTotals } from "../api/types";
import { loadQuickPhrases, saveQuickPhrases } from "../state/quickPhrases";
import { QuickPhrasesRow } from "./QuickPhrasesRow";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import styles from "./Composer.module.css";

// ~4 lines at the textarea's 20px line-height + 16px vertical padding (2 × --space-4).
const TEXTAREA_MAX_HEIGHT_PX = 96;

export interface ComposerProps {
  busy: boolean;
  steerEnabled: boolean;
  steerSupported: boolean;
  imagesSupported: boolean;
  attachments: ImageAttachment[];
  latestUsage?: UsageTotals;
  models: ModelInfo[];
  currentModel?: string | null;
  onModelChange: (modelId: string) => void;
  autoApproveEffective: boolean;
  autoApproveCapable: boolean;
  onAutoApproveToggle: () => void;
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
    models, currentModel, onModelChange,
    autoApproveEffective, autoApproveCapable, onAutoApproveToggle,
    onRemoveAttachment, onAttachFiles,
    onSend, onSteer, onCancel, onQueue, onToggleSteer,
  } = props;
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [phrases, setPhrases] = useState<string[]>(() => loadQuickPhrases());
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, [text]);

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

  const queueClick = () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    void onQueue(trimmed);
    setText("");
  };

  const hasFiles = (ev: DragEvent) => Array.from(ev.dataTransfer.types).includes("Files");

  const onDragEnter = (ev: DragEvent) => {
    if (!imagesSupported || !hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragOver = (ev: DragEvent) => {
    if (!imagesSupported || !hasFiles(ev)) return;
    ev.preventDefault();
  };

  const onDragLeave = (ev: DragEvent) => {
    if (!imagesSupported || !hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (ev: DragEvent) => {
    if (!imagesSupported) return;
    ev.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(ev.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) onAttachFiles(files);
  };

  const isEmpty = !text.trim() && attachments.length === 0;
  const usagePct = latestUsage?.context_used != null && latestUsage?.context_limit
    ? latestUsage.context_used / latestUsage.context_limit
    : null;
  const isWarn = usagePct != null && usagePct > 0.8;
  const usagePctRounded = usagePct != null ? Math.min(100, Math.max(0, Math.round(usagePct * 100))) : 0;

  return (
    <form
      className={dragging ? `${styles.form} ${styles.dragging}` : styles.form}
      onSubmit={submit}
      autoComplete="off"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && <div className={styles.dropOverlay}>Drop images to attach</div>}
      <div className={styles.attachments}>
        {attachments.map((img, idx) => (
          <div key={idx} className={styles.attachment}>
            <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.filename || "image"} />
            <span>{img.filename || `image ${idx + 1}`}</span>
            <Button type="button" onClick={() => onRemoveAttachment(idx)} aria-label="Remove attachment">×</Button>
          </div>
        ))}
      </div>
      <QuickPhrasesRow phrases={phrases} onSubmit={submitPhrase} onAdd={addPhrase} onDelete={deletePhrase} />
      <div className={styles.textareaRow}>
        <textarea
          ref={textareaRef}
          rows={1}
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
      </div>
      <div className={styles.actionRow}>
        <div className={styles.actionsLeft}>
          <button
            type="button"
            className={styles.attachButton}
            onClick={() => fileInputRef.current?.click()}
            disabled={!imagesSupported}
            title="Attach image"
            aria-label="Attach image"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <Select
            value={currentModel ?? ""}
            options={models.map((m) => ({ value: m.modelId, label: m.name || m.modelId }))}
            onChange={onModelChange}
            disabled={models.length === 0}
            aria-label="Model"
          />
          <button
            type="button"
            role="switch"
            aria-checked={autoApproveEffective}
            className={autoApproveEffective ? `${styles.autoApprove} ${styles.autoApproveActive}` : styles.autoApprove}
            onClick={onAutoApproveToggle}
            disabled={!autoApproveCapable}
          >
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchThumb} />
            </span>
            Auto-approve
          </button>
          {latestUsage && latestUsage.context_limit != null && latestUsage.context_limit > 0 && (
            <span className={styles.contextPill}>
              {latestUsage.context_used?.toLocaleString() ?? "0"} / {latestUsage.context_limit.toLocaleString()}
              {" ("}
              <span className={isWarn ? styles.warn : undefined}>
                {isWarn ? "⚠ " : ""}
                {usagePctRounded}%
              </span>
              {")"}
              <span
                className={isWarn ? `${styles.usageBar} ${styles.usageBarWarn}` : styles.usageBar}
                style={{ width: `${usagePctRounded}%` }}
                aria-hidden="true"
              />
            </span>
          )}
        </div>
        <div className={styles.actionsRight}>
          {busy ? (
            <>
              <Button type="button" variant="danger" onClick={() => void onCancel()}>Stop</Button>
              <Button type="button" onClick={queueClick} disabled={isEmpty}>Queue</Button>
              {steerSupported && (
                <Button type="button" variant={steerEnabled ? "primary" : "default"} onClick={onToggleSteer}>Steer</Button>
              )}
            </>
          ) : (
            <Button type="submit" variant="primary" disabled={isEmpty}>Send</Button>
          )}
        </div>
      </div>
    </form>
  );
}
