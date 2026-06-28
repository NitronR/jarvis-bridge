import { useEffect, useState } from "react";
import { fetchJSON } from "../api/client";

interface Skill { name: string; hasUi: boolean; displayName?: string; description?: string; icon?: string; }

export function SkillsManagePanel() {
  const [installed, setInstalled] = useState<Skill[]>([]);
  const [initial, setInitial] = useState<Skill[]>([]);
  useEffect(() => {
    void fetchJSON<{ skills: Skill[] }>("/skills").then((r) => r.ok && setInstalled(r.data!.skills));
    void fetchJSON<{ skills: Skill[] }>("/skills/initial").then((r) => r.ok && setInitial(r.data!.skills));
  }, []);
  return (
    <div style={{ padding: 16 }}>
      <h2>Skills</h2>
      <h3>Installed</h3>
      {installed.length === 0 ? <div style={{ color: "var(--color-text-muted)" }}>(none)</div> : (
        <ul>{installed.map((s) => <li key={s.name}>{s.name}{s.hasUi ? " [ui]" : ""}</li>)}</ul>
      )}
      <h3>Template</h3>
      {initial.length === 0 ? <div style={{ color: "var(--color-text-muted)" }}>(none)</div> : (
        <ul>{initial.map((s) => <li key={s.name}>{s.name}{s.hasUi ? " [ui]" : ""}</li>)}</ul>
      )}
    </div>
  );
}
