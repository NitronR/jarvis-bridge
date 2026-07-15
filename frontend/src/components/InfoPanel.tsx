import { useEffect, useState } from "react";
import type { ChatState } from "../state/ChatContext";
import type { UsageTotals } from "../api/types";
import styles from "./InfoPanel.module.css";

export interface InfoPanelProps {
  state: ChatState;
  title: string;
  group: string;
  pinned: boolean;
  usage?: UsageTotals;
  onRename: (t: string) => void;
  onGroup: (g: string) => void;
  onPinned: (p: boolean) => void;
  onModelChange: (modelId: string) => void;
  onAutoApproveToggle: () => void;
}

// Known rate-limit windows, in the order Claude's own `/usage` output shows
// them. Any unrecognized rateLimitType (future SDK additions) still renders,
// just with a title-cased fallback label instead of one of these.
const RATE_LIMIT_LABELS: Record<string, string> = {
  five_hour: "Session (5h)",
  seven_day: "Week",
  seven_day_opus: "Week (Opus)",
  seven_day_sonnet: "Week (Sonnet)",
  seven_day_overage_included: "Week (overage)",
  overage: "Overage",
};

function rateLimitLabel(type: string): string {
  return RATE_LIMIT_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatResetsAt(resetsAt: number | undefined): string | null {
  if (typeof resetsAt !== "number") return null;
  return new Date(resetsAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" strokeLinejoin="round" />
      <path d="M17 21v-8H7v8M7 3v5h8" strokeLinejoin="round" />
    </svg>
  );
}

export function InfoPanel(props: InfoPanelProps) {
  const { state, title, group, pinned, usage, onRename, onGroup, onPinned, onModelChange, onAutoApproveToggle } = props;
  const [titleDraft, setTitleDraft] = useState(title);
  useEffect(() => setTitleDraft(title), [title]);
  const titleDirty = titleDraft !== title;
  const saveTitle = () => { if (titleDirty) onRename(titleDraft); };
  return (
    <aside className={styles.panel}>
      <div className={styles.card}>
        <h3>Current chat</h3>
        <div className={styles.row}>
          <span className={styles.key}>Title</span>
          <div className={styles.titleField}>
            <input
              placeholder="Untitled"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); }}
            />
            <button
              type="button"
              className={styles.saveButton}
              aria-label="Save title"
              title="Save title"
              disabled={!titleDirty}
              onClick={saveTitle}
            >
              <SaveIcon />
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Group</span>
          <input value={group} onChange={(e) => onGroup(e.target.value)} />
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Pinned</span>
          <button
            type="button"
            className={`${styles.pinButton} ${pinned ? styles.pinButtonActive : ""}`}
            onClick={() => onPinned(!pinned)}
            aria-label={pinned ? "Unpin session" : "Pin session"}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 2l-1.5 4 5 5 4-1.5v3l-5 1.5-3.5 6.5L13 17l-6 6-1.5-1.5 6-6-3.5-2.5L9.5 8 8 3h3L9.5 7.5l4 4 4-5.5L16 2z" />
            </svg>
          </button>
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

      {usage && (usage.rate_limits || usage.cost) && (
        <div className={styles.card}>
          <h3>Usage</h3>
          {usage.rate_limits &&
            Object.entries(usage.rate_limits).map(([type, w]) => {
              const pct = typeof w.utilization === "number" ? Math.round(w.utilization * 100) : null;
              const resets = formatResetsAt(w.resetsAt);
              return (
                <div key={type}>
                  <div className={styles.row}>
                    <span className={styles.key}>{rateLimitLabel(type)}</span>
                    <span className={`${styles.val} ${pct != null && pct >= 80 ? styles.warn : ""}`}>
                      {pct != null ? `${pct}%` : w.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  {resets && <div className={styles.resetNote}>resets {resets}</div>}
                </div>
              );
            })}
          {usage.cost && (
            <div className={styles.row}>
              <span className={styles.key}>Session cost</span>
              <span className={styles.val}>${usage.cost.amount.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
