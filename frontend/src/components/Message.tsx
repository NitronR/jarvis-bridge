import { Timeline } from "./Timeline";
import type { ImageAttachment, ChatPatch } from "../api/types";
import styles from "./Message.module.css";

export type MessageEntry =
  | { role: "user"; text: string; images?: ImageAttachment[] }
  | { role: "assistant"; patches: ChatPatch[] };

export function Message({
  entry,
  onApproval,
  onSteerAck,
  onImagesSkipped,
}: {
  entry: MessageEntry;
  onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
  onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
}) {
  if (entry.role === "user") {
    return (
      <div className={`${styles.message} ${styles.user}`}>
        <div className={styles.role}>You</div>
        <div className={styles.bubble}>
          {entry.text && <div>{entry.text}</div>}
          {entry.images && entry.images.length > 0 && (
            <div className={styles.attachments}>
              {entry.images.map((img, idx) => (
                <img key={idx} src={`data:${img.mimeType};base64,${img.data}`} alt={img.filename || "image"} title={img.filename} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  const hasError = entry.patches.some((p) => p.type === "error");
  return (
    <div className={`${styles.message} ${styles.assistant} ${hasError ? styles.error : ""}`}>
      <div className={styles.role}>Assistant</div>
      <div className={styles.bubble}>
        <Timeline patches={entry.patches} onApproval={onApproval} onSteerAck={onSteerAck} onImagesSkipped={onImagesSkipped} />
      </div>
    </div>
  );
}
