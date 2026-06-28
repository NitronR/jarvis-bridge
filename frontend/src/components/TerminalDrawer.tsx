import { useEffect, useState } from "react";

export function TerminalDrawer({ cwd }: { cwd: string | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "`" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        setOpen((v) => !v);
      } else if (ev.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    (window as { JarvisTerminal?: { toggle: () => void } }).JarvisTerminal = {
      toggle: () => setOpen((v) => !v),
    };
    return () => { delete (window as { JarvisTerminal?: unknown }).JarvisTerminal; };
  }, []);

  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", right: 0, bottom: 0, width: 600, maxWidth: "80vw",
        height: 320, background: "#000", border: "1px solid var(--color-border)",
        borderRight: "none", borderBottom: "none",
        borderTopLeftRadius: "var(--radius-md)",
        display: "flex", flexDirection: "column", zIndex: 80,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", padding: "4px 8px", background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-border)", fontSize: 12, gap: 8 }}>
        <span>Terminal</span>
        <span style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>{cwd || "—"}</span>
        <button onClick={() => setOpen(false)}>×</button>
      </header>
      <pre style={{ flex: 1, margin: 0, padding: "6px 8px", background: "#000", color: "#d8f5ff", fontFamily: "var(--font-mono)", fontSize: 12, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        [terminal not yet wired — backend /terminal WebSocket is not implemented]
      </pre>
      <input style={{ width: "100%", background: "#001020", color: "#d8f5ff", border: "none", borderTop: "1px solid var(--color-border)", padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 12 }} placeholder="(terminal WS not yet wired)" disabled />
    </div>
  );
}
