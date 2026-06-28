import type { ChatState } from "../state/ChatContext";
import styles from "./InfoPanel.module.css";

export interface InfoPanelProps {
  state: ChatState;
  title: string;
  group: string;
  pinned: boolean;
  onRename: (t: string) => void;
  onGroup: (g: string) => void;
  onPinned: (p: boolean) => void;
  onModelChange: (modelId: string) => void;
  onAutoApproveToggle: () => void;
}

export function InfoPanel(props: InfoPanelProps) {
  const { state, title, group, pinned, onRename, onGroup, onPinned, onModelChange, onAutoApproveToggle } = props;
  return (
    <aside className={styles.panel}>
      <div className={styles.card}>
        <h3>Current chat</h3>
        <div className={styles.row}>
          <span className={styles.key}>Title</span>
          <input placeholder="Untitled" value={title} onChange={(e) => onRename(e.target.value)} />
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Group</span>
          <input value={group} onChange={(e) => onGroup(e.target.value)} />
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Pinned</span>
          <input type="checkbox" checked={pinned} onChange={(e) => onPinned(e.target.checked)} />
        </div>
      </div>

      <div className={styles.card}>
        <h3>Overview</h3>
        <div className={styles.row}>
          <span className={styles.key}>Workspace</span>
          <span className={styles.val}>{state.cwd ?? "—"}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Model</span>
          <select value={state.currentModel ?? ""} onChange={(e) => onModelChange(e.target.value)} disabled={state.models.length === 0}>
            {state.models.map((m) => (
              <option key={m.modelId} value={m.modelId}>{m.name || m.modelId}</option>
            ))}
          </select>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Auto-approve</span>
          <button
            type="button"
            data-testid="auto-approve-toggle"
            className={state.autoApprove.effective ? "primary" : ""}
            onClick={onAutoApproveToggle}
          >
            {state.autoApprove.effective ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <h3>Session</h3>
        <div className={styles.row}>
          <span className={styles.key}>ID</span>
          <span className={styles.val}>{state.sessionId ?? "—"}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Slash cmds</span>
          <span className={styles.val}>{state.slashCommands.length}</span>
        </div>
      </div>
    </aside>
  );
}
