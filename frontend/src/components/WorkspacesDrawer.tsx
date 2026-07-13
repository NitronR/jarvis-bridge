import { useEffect, type MouseEvent } from "react";
import styles from "./WorkspacesDrawer.module.css";

export interface WorkspacesDrawerProps {
  open: boolean;
  recentWorkspaces: string[];
  onClose: () => void;
  onOpenInWorkspace: (cwd: string) => void;
  onOpenInNewTab: (cwd: string) => void;
  onPickFolder: () => void;
  pickDisabled?: boolean;
}

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

export function WorkspacesDrawer({
  open,
  recentWorkspaces,
  onClose,
  onOpenInWorkspace,
  onOpenInNewTab,
  onPickFolder,
  pickDisabled,
}: WorkspacesDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      data-testid="workspaces-drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Workspaces"
      >
        <header className={styles.header}>
          <h2 className={styles.headerTitle}>Workspaces</h2>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </header>
        <div className={styles.pickerBar}>
          <button
            type="button"
            className={styles.pickerButton}
            onClick={onPickFolder}
            disabled={pickDisabled}
          >
            Open folder…
          </button>
        </div>
        {recentWorkspaces.length === 0 ? (
          <div className={styles.empty}>No recent workspaces yet.</div>
        ) : (
          <ul className={styles.list}>
            {recentWorkspaces.map((cwd) => (
              <li
                key={cwd}
                className={styles.card}
                onClick={(e: MouseEvent<HTMLLIElement>) => {
                  if (e.metaKey || e.ctrlKey) {
                    onOpenInNewTab(cwd);
                    return;
                  }
                  onOpenInWorkspace(cwd);
                }}
              >
                <div className={styles.basename}>{basename(cwd)}</div>
                <div className={styles.fullPath}>{cwd}</div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}