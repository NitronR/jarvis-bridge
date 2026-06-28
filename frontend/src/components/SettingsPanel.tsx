import { useEffect, useState } from "react";

const KEY = "jarvis.quickPhrases";

function load(): string[] {
  try { const raw = localStorage.getItem(KEY); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function save(phrases: string[]) {
  localStorage.setItem(KEY, JSON.stringify(phrases));
  document.dispatchEvent(new CustomEvent("jarvis:quick-phrases-changed", { detail: { phrases } }));
}

export function SettingsPanel() {
  const [phrases, setPhrases] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => { setPhrases(load()); }, []);

  const add = () => {
    if (!draft.trim()) return;
    const next = [...phrases, draft.trim()];
    setPhrases(next); save(next); setDraft("");
  };

  const remove = (idx: number) => {
    const next = phrases.filter((_, i) => i !== idx);
    setPhrases(next); save(next);
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Settings</h2>
      <h3>Quick phrases</h3>
      <p style={{ color: "var(--color-text-muted)" }}>Click to insert into the composer. Saved locally.</p>
      <ul>
        {phrases.map((p, idx) => (
          <li key={idx}>
            {p} <button onClick={() => remove(idx)}>remove</button>
          </li>
        ))}
      </ul>
      <div>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New quick phrase…" />
        <button onClick={add}>Add</button>
      </div>
    </div>
  );
}
