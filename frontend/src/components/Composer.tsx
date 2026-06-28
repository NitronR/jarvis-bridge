import { useRef, useState, type FormEvent } from "react";
import type { ImageAttachment } from "../api/types";
import styles from "./Composer.module.css";

export interface ComposerProps {
  busy: boolean;
  steerEnabled: boolean;
  steerSupported: boolean;
  imagesSupported: boolean;
  attachments: ImageAttachment[];
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
    attachments, onRemoveAttachment, onAttachFiles,
    onSend, onSteer, onCancel, onQueue, onToggleSteer,
  } = props;
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = (ev?: FormEvent) => {
    if (ev) ev.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (steerEnabled) void onSteer(trimmed);
    else if (busy) void onQueue(trimmed);
    else onSend(trimmed);
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
      <div className={styles.row}>
        <textarea
          rows={2}
          placeholder={steerEnabled ? "Steer the running turn…" : "Type a message… (Shift+Enter for newline, Enter to send)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy && !steerEnabled}
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
    </form>
  );
}
