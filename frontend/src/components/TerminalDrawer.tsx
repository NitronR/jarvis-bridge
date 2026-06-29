import { useEffect, useRef, useState } from "react";

export function TerminalDrawer({ cwd }: { cwd: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{
    term: { write: (s: string) => void; dispose: () => void; onData: (cb: (s: string) => void) => void; onResize: (cb: (e: { cols: number; rows: number }) => void) => void };
    fit: () => void;
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<string>("idle");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      if (disposed) return;
      const term = new Terminal({ convertEol: true, fontFamily: "var(--font-mono, monospace)", fontSize: 12, theme: { background: "#001020" } });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      fit.fit();
      const api = {
        term: {
          write: (s: string) => term.write(s),
          dispose: () => term.dispose(),
          onData: (cb: (s: string) => void) => { term.onData(cb); },
          onResize: (cb: (e: { cols: number; rows: number }) => void) => { term.onResize(cb); },
        },
        fit: () => fit.fit(),
      };
      termRef.current = api;

      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${wsProto}//${window.location.host}/terminal?cwd=${encodeURIComponent(cwd ?? "")}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      setStatus("connecting…");
      ws.onopen = () => setStatus("connected");
      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === "string") {
          if (ev.data.startsWith("{")) {
            try {
              const ctrl = JSON.parse(ev.data);
              if (ctrl.type === "exit") {
                setStatus(`exit code=${ctrl.code}${ctrl.signal ? ` signal=${ctrl.signal}` : ""}`);
                term.write(`\r\n\x1b[2m[exit code=${ctrl.code}]\x1b[0m\r\n`);
                return;
              }
            } catch { /* not a control frame — fall through to terminal */ }
          }
          term.write(ev.data);
        } else if (ev.data instanceof ArrayBuffer) {
          term.write(new TextDecoder().decode(ev.data));
        }
      };
      ws.onclose = (ev: CloseEvent) => setStatus(`disconnected (${ev.code})`);
      ws.onerror = () => setStatus("ws error");

      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
      });
      fit.fit();
    })().catch((err: unknown) => {
      setStatus(`init failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    const ro = new ResizeObserver(() => termRef.current?.fit());
    if (container) ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      try { wsRef.current?.close(); } catch { /* ignore */ }
      termRef.current?.term.dispose();
      termRef.current = null;
    };
  }, [cwd]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "4px 8px", fontSize: 11, color: "var(--color-text-muted, #888)",
        borderBottom: "1px solid var(--color-border, #333)",
      }}>
        <span>shell · cwd={cwd ?? "(unset)"} · {status}</span>
      </header>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, background: "#001020", padding: 4 }} />
    </div>
  );
}
