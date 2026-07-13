import type { SessionSummary } from "../api/types";

export interface PastChatsMenuProps {
  open: boolean;
  sessions: SessionSummary[];
  onClose: () => void;
  onSwitch: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  canDelete?: boolean;
}

export function PastChatsMenu({ open, sessions, onClose, onSwitch, onDelete, canDelete }: PastChatsMenuProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--color-surface-1)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)", minWidth: 360, maxHeight: "70vh",
        overflowY: "auto", padding: 14,
      }}>
        <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>Chats</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {sessions.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)" }}>(no past chats yet)</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.sessionId} style={{ padding: "4px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => onSwitch(s.sessionId)}>
                  {s.customTitle || s.title || s.sessionId.slice(0, 12)}
                  {s.pinned ? " 📌" : ""}
                </span>
                {canDelete && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete?.(s.sessionId); }}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
