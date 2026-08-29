import { useEffect, useState } from "react";
import { fetchJSON } from "../api/client";
import { loadQuickPhrases, saveQuickPhrases } from "../state/quickPhrases";
import type { ConfigDefaultsState, DefaultBackendState } from "../api/types";
import styles from "./SettingsDialog.module.css";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phrases, setPhrases] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [backends, setBackends] = useState<DefaultBackendState | null>(null);
  const [backendSaving, setBackendSaving] = useState(false);
  const [configDefaults, setConfigDefaults] = useState<ConfigDefaultsState | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhrases(loadQuickPhrases());
    setDraft("");
    void fetchJSON<DefaultBackendState>("/settings/default-backend").then((res) => {
      if (res.ok && res.data) setBackends(res.data);
    });
    void fetchJSON<ConfigDefaultsState>("/settings/config-defaults").then((res) => {
      if (res.ok && res.data) setConfigDefaults(res.data);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const onChangeDefaultBackend = async (name: string) => {
    setBackendSaving(true);
    try {
      const res = await fetchJSON<DefaultBackendState>("/settings/default-backend", {
        method: "PUT",
        body: { name },
      });
      if (res.ok && res.data) setBackends((prev) => (prev ? { ...prev, default: res.data.default } : prev));
    } finally {
      setBackendSaving(false);
    }
  };

  const onChangeConfigDefault = async (backend: string, configId: string, raw: string) => {
    const value = raw === "" ? null : raw;
    const res = await fetchJSON<{ ok: boolean; defaults: Record<string, string> }>(
      "/settings/config-default",
      { method: "PUT", body: { backend, configId, value } },
    );
    if (!res.ok || !res.data) return;
    setConfigDefaults((prev) =>
      prev
        ? {
            backends: prev.backends.map((b) =>
              b.name === backend ? { ...b, defaults: res.data!.defaults } : b,
            ),
          }
        : prev,
    );
  };

  const add = () => {
    if (!draft.trim()) return;
    const next = [...phrases, draft.trim()];
    setPhrases(next); saveQuickPhrases(next); setDraft("");
  };

  const remove = (idx: number) => {
    const next = phrases.filter((_, i) => i !== idx);
    setPhrases(next); saveQuickPhrases(next);
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2>Settings</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className={styles.body}>
          <h3>Default agent backend</h3>
          {backends ? (
            <>
              <p className={styles.muted}>
                New chats use this backend. Restart-free — takes effect on the next new session.
              </p>
              <select
                value={backends.default}
                disabled={backendSaving}
                onChange={(e) => void onChangeDefaultBackend(e.target.value)}
              >
                {backends.available.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </>
          ) : (
            <p className={styles.muted}>Loading…</p>
          )}
          <h3>Backend defaults</h3>
          <p className={styles.muted}>
            Applied to sessions on that backend unless the chat has its own setting.
          </p>
          {configDefaults?.backends.map((b) => (
            <div key={b.name}>
              <h4>{b.name}</h4>
              {b.options.length === 0 ? (
                <p className={styles.muted}>Start a chat on this backend to configure its defaults.</p>
              ) : (
                b.options.map((opt) => (
                  <label key={opt.id}>
                    {`${b.name} — ${opt.name}`}
                    <select
                      value={b.defaults[opt.id] ?? ""}
                      onChange={(e) => void onChangeConfigDefault(b.name, opt.id, e.target.value)}
                    >
                      <option value="">Agent default</option>
                      {opt.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.name}</option>
                      ))}
                    </select>
                  </label>
                ))
              )}
            </div>
          ))}
          <h3>Quick phrases</h3>
          <p className={styles.muted}>Available from the ⚡ picker in the composer. Saved locally.</p>
          <ul>
            {phrases.map((p, idx) => (
              <li key={idx}>
                {p} <button onClick={() => remove(idx)}>remove</button>
              </li>
            ))}
          </ul>
          <div className={styles.addRow}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New quick phrase…" />
            <button onClick={add}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}
