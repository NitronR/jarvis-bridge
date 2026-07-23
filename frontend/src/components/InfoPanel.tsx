import type { ChatState } from "../state/ChatContext";
import type { UsageTotals } from "../api/types";
import styles from "./InfoPanel.module.css";
import { Button } from "./ui/Button";

export interface InfoPanelProps {
  state: ChatState;
  usage?: UsageTotals;
  usageQuerySupported?: boolean;
  refreshingUsage?: boolean;
  onRefreshUsage?: () => void;
}

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
    state, usage, usageQuerySupported, refreshingUsage,
    onRefreshUsage,
  } = props;
  return (
    <aside className={styles.panel}>
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
    </aside>
  );
}
