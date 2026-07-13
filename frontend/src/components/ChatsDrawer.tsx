import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { SessionSummary } from "../api/types";
import styles from "./ChatsDrawer.module.css";

export interface ChatsDrawerProps {
  open: boolean;
  sessions: SessionSummary[];
  recentWorkspaces?: string[];
  onClose: () => void;
  onSwitch: (sessionId: string) => void;
  onOpenInNewTab?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  canDelete?: boolean;
  getTurnCount?: (sessionId: string) => number | undefined;
}

const FILTER_ALL = "__all__";
const FILTER_STORAGE_KEY = "jarvis.lastChatsFilter";
const BACKEND_FILTER_STORAGE_KEY = "jarvis.lastChatsBackendFilter";

function formatRelative(updatedAt: string | null | undefined): string {
  if (!updatedAt) return "";
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(updatedAt).toLocaleDateString();
}

function basename(p: string | undefined): string {
  if (!p) return "";
  const trimmed = p.replace(/\/+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

function safeGetStoredFilter(): string {
  try {
    return window.localStorage?.getItem(FILTER_STORAGE_KEY) ?? FILTER_ALL;
  } catch {
    return FILTER_ALL;
  }
}

function safeSetStoredFilter(value: string): void {
  try {
    window.localStorage?.setItem(FILTER_STORAGE_KEY, value);
  } catch {
    // ignore (storage may be unavailable)
  }
}

function safeGetStoredBackendFilter(): string {
  try {
    return window.localStorage?.getItem(BACKEND_FILTER_STORAGE_KEY) ?? FILTER_ALL;
  } catch {
    return FILTER_ALL;
  }
}

function safeSetStoredBackendFilter(value: string): void {
  try {
    window.localStorage?.setItem(BACKEND_FILTER_STORAGE_KEY, value);
  } catch {
    // ignore (storage may be unavailable)
  }
}

function PinIcon() {
  return (
    <svg
      className={styles.pinIcon}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16 2l-1.5 4 5 5 4-1.5v3l-5 1.5-3.5 6.5L13 17l-6 6-1.5-1.5 6-6-3.5-2.5L9.5 8 8 3h3L9.5 7.5l4 4 4-5.5L16 2z" />
    </svg>
  );
}

export function ChatsDrawer({
  open,
  sessions,
  recentWorkspaces,
  onClose,
  onSwitch,
  onOpenInNewTab,
  onDelete,
  canDelete,
  getTurnCount,
}: ChatsDrawerProps) {
  const [filter, setFilter] = useState<string>(() => safeGetStoredFilter());
  const [backendFilter, setBackendFilter] = useState<string>(() => safeGetStoredBackendFilter());
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const workspaces = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (cwd: string | undefined) => {
      const b = basename(cwd);
      if (!b) return;
      const key = b.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(b);
    };
    for (const s of sessions) add(s.cwd);
    for (const r of recentWorkspaces ?? []) add(r);
    return out.sort((a, b) => a.localeCompare(b));
  }, [sessions, recentWorkspaces]);

  const backends = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of sessions) {
      if (!s.backendName) continue;
      if (seen.has(s.backendName)) continue;
      seen.add(s.backendName);
      out.push(s.backendName);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    let list = sessions;
    if (filter !== FILTER_ALL) {
      const target = filter.toLowerCase();
      list = list.filter((s) => basename(s.cwd).toLowerCase() === target);
    }
    if (backendFilter !== FILTER_ALL) {
      list = list.filter((s) => s.backendName === backendFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((s) => s.sessionId.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });
  }, [sessions, filter, backendFilter, searchQuery]);

  if (!open) return null;

  const handleFilterChange = (next: string) => {
    setFilter(next);
    safeSetStoredFilter(next);
  };

  const handleBackendFilterChange = (next: string) => {
    setBackendFilter(next);
    safeSetStoredBackendFilter(next);
  };

  return (
    <div
      className={styles.backdrop}
      data-testid="chats-drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Past chats"
      >
        <header className={styles.header}>
          <h2 className={styles.headerTitle}>Chats</h2>
          {workspaces.length > 0 && (
            <select
              className={styles.filterSelect}
              aria-label="Workspace"
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value)}
            >
              <option value={FILTER_ALL}>All workspaces</option>
              {workspaces.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          )}
          {backends.length > 1 && (
            <select
              className={styles.filterSelect}
              aria-label="Backend"
              value={backendFilter}
              onChange={(e) => handleBackendFilterChange(e.target.value)}
            >
              <option value={FILTER_ALL}>All backends</option>
              {backends.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </header>
        <div className={styles.searchBar}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by session ID…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {sessions.length === 0 ? (
          <div className={styles.empty}>(no past chats yet)</div>
        ) : filteredSessions.length === 0 ? (
          <div className={styles.empty}>
            {searchQuery.trim() ? "No sessions match that ID." : "No chats in this workspace."}
          </div>
        ) : (
          <ul className={styles.list}>
            {filteredSessions.map((s) => {
              const title = s.customTitle || s.title || s.sessionId.slice(0, 12);
              const turnCount = getTurnCount?.(s.sessionId);
              return (
                <li
                  key={s.sessionId}
                  className={`${styles.card} ${s.active ? styles.cardActive : ""}`}
                  onClick={(e: MouseEvent<HTMLLIElement>) => {
                    if ((e.metaKey || e.ctrlKey) && onOpenInNewTab) {
                      onOpenInNewTab(s.sessionId);
                      return;
                    }
                    onSwitch(s.sessionId);
                  }}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.cardTitle}>{title}</div>
                    {s.updatedAt && (
                      <div className={styles.cardTime}>{formatRelative(s.updatedAt)}</div>
                    )}
                  </div>
                  <div className={styles.cardMeta}>
                    <span className={styles.sessionId}>{s.sessionId.slice(0, 12)}</span>
                    {s.backendName && <span className={styles.badge}>{s.backendName}</span>}
                    {s.cwd && <span className={styles.workspace}>{basename(s.cwd)}</span>}
                    {s.group && <span className={styles.group}>{s.group}</span>}
                    {!!turnCount && (
                      <span className={styles.turnCount}>{turnCount} msgs</span>
                    )}
                    {s.pinned && (
                      <span className={styles.pinPill} aria-label="Pinned">
                        <PinIcon />
                        Pinned
                      </span>
                    )}
                  </div>
                  {canDelete && (
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.deleteButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete?.(s.sessionId);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}