import { useEffect, useState } from "react";
import type { ChatState } from "../state/ChatContext";
import type { UsageTotals } from "../api/types";
import styles from "./InfoPanel.module.css";

export interface InfoPanelProps {
  state: ChatState;
  title: string;
  group: string;
  groups: string[];
  pinned: boolean;
  usage?: UsageTotals;
  usageQuerySupported?: boolean;
  refreshingUsage?: boolean;
  onRename: (t: string) => void;
  onGroup: (g: string) => void;
  onAddGroup: (name: string) => Promise<void>;
  onPinned: (p: boolean) => void;
  onAutoApproveToggle: () => void;
  onRefreshUsage?: () => void;
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

// Prefers the exact epoch-ms value; falls back to the human-readable text a
// manual /chat/usage refresh provides (see RateLimitWindow.resetsAtText —
// there's no reliable way to parse "Jul 15 at 2pm (Asia/Calcutta)" into an
// exact timestamp, so it's rendered verbatim instead).
function formatResetsAt(resetsAt: number | undefined, resetsAtText: string | undefined): string | null {
  if (typeof resetsAt === "number") {
    return new Date(resetsAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return resetsAtText ?? null;
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" strokeLinejoin="round" />
      <path d="M17 21v-8H7v8M7 3v5h8" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
      className={spinning ? styles.spinning : undefined}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function InfoPanel(props: InfoPanelProps) {
  const {
    state, title, group, groups, pinned, usage, usageQuerySupported, refreshingUsage,
    onRename, onGroup, onAddGroup, onPinned, onAutoApproveToggle, onRefreshUsage,
  } = props;
  const [titleDraft, setTitleDraft] = useState(title);
  useEffect(() => setTitleDraft(title), [title]);
  const titleDirty = titleDraft !== title;
  const saveTitle = () => { if (titleDirty) onRename(titleDraft); };
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const handleGroupChange = (value: string) => {
    if (value === "__add_group__") {
      setAddGroupOpen(true);
      setNewGroupName("");
      return;
    }
    onGroup(value);
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    await onAddGroup(name);
    onGroup(name);
    setAddGroupOpen(false);
    setNewGroupName("");
  };
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
          <label className={styles.key} htmlFor="group-select">Group</label>
          <select
            id="group-select"
            value={group || ""}
            onChange={(e) => handleGroupChange(e.target.value)}
          >
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
            <option value="__add_group__">+ Add Group…</option>
          </select>
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

      {(usageQuerySupported || (usage && (usage.rate_limits || usage.cost))) && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h3>Usage</h3>
            {usageQuerySupported && (
              <button
                type="button"
                className={styles.refreshButton}
                aria-label="Refresh usage"
                title="Refresh usage"
                disabled={refreshingUsage}
                onClick={onRefreshUsage}
              >
                <RefreshIcon spinning={refreshingUsage} />
              </button>
            )}
          </div>
          {usage?.rate_limits &&
            Object.entries(usage.rate_limits).map(([type, w]) => {
              const pct = typeof w.utilization === "number" ? Math.round(w.utilization * 100) : null;
              const resets = formatResetsAt(w.resetsAt, w.resetsAtText);
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
          {usage?.cost && (
            <div className={styles.row}>
              <span className={styles.key}>Session cost</span>
              <span className={styles.val}>${usage.cost.amount.toFixed(2)}</span>
            </div>
          )}
          {usageQuerySupported && !usage?.rate_limits && (
            <div className={styles.row}>
              <span className={styles.key}>—</span>
              <span className={styles.val}>tap refresh</span>
            </div>
          )}
        </div>
      )}
      {addGroupOpen && (
        <div className={styles.dialogBackdrop} onClick={() => setAddGroupOpen(false)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h4>Add Group</h4>
            <input
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }}
              autoFocus
            />
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setAddGroupOpen(false)}>Cancel</button>
              <button type="button" onClick={handleCreateGroup}>Create</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
