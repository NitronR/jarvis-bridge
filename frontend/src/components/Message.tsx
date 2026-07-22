import { Timeline } from "./Timeline";
import { Avatar } from "./ui/Avatar";
import type { ImageAttachment, ChatPatch } from "../api/types";
import styles from "./Message.module.css";

export type MessageEntry =
  | { role: "user"; text: string; images?: ImageAttachment[] }
  | { role: "assistant"; patches: ChatPatch[] };

export function Message({
  entry,
  showAvatar = true,
  backendKind,
  onApproval,
  onElicitation,
  onSteerAck,
  onImagesSkipped,
}: {
  entry: MessageEntry;
  showAvatar?: boolean;
  backendKind?: string | null;
  onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
  onElicitation?: (p: ChatPatch & { type: "elicitation-request" }) => void;
  onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
}) {
  const avatarSlot = showAvatar ? (
    <Avatar role={entry.role} />
  ) : (
    <span className={styles.avatarSpacer} aria-hidden="true" />
  );

  if (entry.role === "user") {
    return (
      <div className={`${styles.message} ${styles.user}`}>
        {avatarSlot}
        <div className={styles.column}>
          <div className={styles.bubble}>
            {entry.text && <div>{entry.text}</div>}
            {entry.images && entry.images.length > 0 && (
              <div className={styles.attachments}>
                {entry.images.map((img, idx) => (
                  <img
                    key={idx}
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={img.filename || "image"}
                    title={img.filename}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const hasError = entry.patches.some((p) => p.type === "error");
  return (
    <div className={`${styles.message} ${styles.assistant} ${hasError ? styles.error : ""}`}>
      {avatarSlot}
      <div className={styles.column}>
        <Timeline
          patches={entry.patches}
          backendKind={backendKind}
          onApproval={onApproval}
          onElicitation={onElicitation}
          onSteerAck={onSteerAck}
          onImagesSkipped={onImagesSkipped}
        />
      </div>
    </div>
  );
}
