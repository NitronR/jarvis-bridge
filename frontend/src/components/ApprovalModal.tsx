import type { ChatPatch } from "../api/types";
import styles from "./ApprovalModal.module.css";

interface ApprovalRequestPatch extends ChatPatch {
  type: "approval-request";
}

export function ApprovalModal({
  patch, onResolve,
}: {
  patch: ApprovalRequestPatch | null;
  onResolve: (requestId: string, optionId: string) => void;
}) {
  if (!patch) return null;
  const options = patch.options || [];
  const hasReject = options.some((o) =>
    /reject|deny|cancel/i.test(o.id || "") || /reject|deny|cancel/i.test(o.name || ""),
  );
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <header className={styles.header}><h2>Approve tool call</h2></header>
        <div className={styles.body}>
          <div>The agent wants to run:</div>
          <div><strong>{patch.toolName}</strong></div>
          <div className={styles.options}>
            {options.map((o) => (
              <button key={o.id} type="button" onClick={() => onResolve(patch.requestId, o.id)}>
                {o.name || o.id}
              </button>
            ))}
            {!hasReject && (
              <button type="button" className="danger" onClick={() => onResolve(patch.requestId, "reject")}>
                Deny
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
