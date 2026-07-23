import { useState } from "react";
import type { ChatState } from "../state/ChatContext";
import type { UsageTotals } from "../api/types";
import styles from "./InfoPanel.module.css";
import { Button } from "./ui/Button";

export interface InfoPanelProps {
  state: ChatState;
  title: string;
  pinned: boolean;
  usage?: UsageTotals;
  usageQuerySupported?: boolean;
  refreshingUsage?: boolean;
  onRename: (t: string) => void;
  onPinned: (p: boolean) => void;
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
    state, title, pinned, usage, usageQuerySupported, refreshingUsage,
    onRename, onPinned, onRefreshUsage,
  } = props;
  const [titleDraft, setTitleDraft] = useState(title);
  const [editingTitle, setEditingTitle] = useState(false);
  const openTitleEdit = () => { setTitleDraft(title); setEditingTitle(true); };
  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft !== title) onRename(titleDraft);
  };
  const revertTitle = () => setEditingTitle(false);
  return (
    <aside className={styles.panel}>
      <div className={styles.section}>
        <h3>Current chat</h3>
        <div className={styles.row}>
          <span className={styles.key}>Title</span>
          {editingTitle ? (
            <input
              className={styles.titleInput}
              aria-label="Title"
              placeholder="Untitled"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") revertTitle();
              }}
              onBlur={commitTitle}
            />
          ) : (
            <span
              className={styles.titleDisplay}
              role="button"
              tabIndex={0}
              aria-label="Edit title"
              onClick={openTitleEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openTitleEdit();
                }
              }}
            >
              {title || "Untitled"}
              <span className={styles.titlePencil} aria-hidden="true">&#9998;</span>
            </span>
          )}
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Pinned</span>
          <Button
            type="button"
            className={`${styles.pinButton} ${pinned ? styles.pinButtonActive : ""}`}
            onClick={() => onPinned(!pinned)}
            aria-label={pinned ? "Unpin session" : "Pin session"}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 2l-1.5 4 5 5 4-1.5v3l-5 1.5-3.5 6.5L13 17l-6 6-1.5-1.5 6-6-3.5-2.5L9.5 8 8 3h3L9.5 7.5l4 4 4-5.5L16 2z" />
            </svg>
          </Button>
        </div>
      </div>

      {(usageQuerySupported || (usage && (usage.rate_limits || usage.cost))) && (
        <div className={styles.section}>
          <div className={styles.sectionLabelRow}>
            <h3>Usage</h3>
            {usageQuerySupported && (
              <Button
                type="button"
                className={styles.refreshButton}
                aria-label="Refresh usage"
                title="Refresh usage"
                disabled={refreshingUsage}
                onClick={onRefreshUsage}
              >
                <RefreshIcon spinning={refreshingUsage} />
              </Button>
            )}
          </div>
          {usage?.rate_limits &&
            Object.entries(usage.rate_limits).map(([type, w]) => {
              const pct = typeof w.utilization === "number" ? Math.round(w.utilization * 100) : null;
              const isWarn = pct != null && pct >= 80;
              const resets = formatResetsAt(w.resetsAt, w.resetsAtText);
              const label = rateLimitLabel(type);
              return (
                <div key={type}>
                  <div className={styles.row}>
                    <span className={styles.key}>{label}</span>
                    <span className={`${styles.val} ${isWarn ? styles.warn : ""}`}>
                      {pct != null ? `${isWarn ? "⚠ " : ""}${pct}%` : w.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  {pct != null && (
                    <div
                      className={styles.meterTrack}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${label} usage`}
                    >
                      <div
                        className={`${styles.meterFill} ${isWarn ? styles.meterFillWarn : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
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

      <div className={styles.section}>
        <h3>Session & workspace</h3>
        <div className={styles.row}>
          <span className={styles.key}>Workspace</span>
          <span className={styles.val}>{state.cwd ?? "—"}</span>
        </div>
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
