import type { Server as HttpServer, IncomingMessage } from "node:http";
import { existsSync } from "node:fs";
import { WebSocketServer } from "ws";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty: typeof import("@homebridge/node-pty-prebuilt-multiarch") = require("@homebridge/node-pty-prebuilt-multiarch");

export interface AttachOpts {
  server: HttpServer;
  workspace: string;
  enabled: boolean;
}

export interface AttachHandle {
  close: () => Promise<void>;
}

export function attachTerminalServer(opts: AttachOpts): AttachHandle {
  const wss = new WebSocketServer({ noServer: true });
  const tracked = new Set<IPty>();

  const onUpgrade = (req: IncomingMessage, socket: import("node:net").Socket, head: Buffer) => {
    if (!req.url || !req.url.startsWith("/terminal")) return;
    if (!opts.enabled) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };
  opts.server.on("upgrade", onUpgrade);

  wss.on("connection", (ws, req) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/terminal", `http://${host}`);
    const requestedCwd = url.searchParams.get("cwd");
    const cwd = requestedCwd && existsSync(requestedCwd) ? requestedCwd : opts.workspace;

    const file = process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : (process.env.SHELL || "/bin/bash");
    const args = process.platform === "win32" ? [] : ["-l"];

    const term: IPty = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: "xterm-256color", JARVIS_BRIDGE_WORKSPACE: opts.workspace } as Record<string, string>,
    });
    tracked.add(term);

    term.onData((data: string) => {
      try { ws.send(data); } catch { /* socket closed */ }
    });
    term.onExit(({ exitCode, signal }) => {
      try { ws.send(JSON.stringify({ type: "exit", code: exitCode, signal })); } catch { /* ignore */ }
      try { ws.close(1000); } catch { /* ignore */ }
      tracked.delete(term);
    });

    ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        try { term.write(raw.toString("utf8")); } catch { /* pty dead */ }
        return;
      }
      const s = raw.toString("utf8");
      if (s.startsWith("{")) {
        let ctrl: { type?: string; cols?: number; rows?: number; data?: string } | null = null;
        try { ctrl = JSON.parse(s); } catch { /* fall through */ }
        if (ctrl?.type === "resize" && Number.isInteger(ctrl.cols) && Number.isInteger(ctrl.rows)) {
          const cols = Math.max(1, Math.min(500, ctrl.cols!));
          const rows = Math.max(1, Math.min(200, ctrl.rows!));
          try { term.resize(cols, rows); } catch { /* pty dead */ }
        } else if (ctrl?.type === "input" && typeof ctrl.data === "string") {
          try { term.write(ctrl.data); } catch { /* pty dead */ }
        }
        return;
      }
      try { term.write(s); } catch { /* pty dead */ }
    });

    ws.on("close", () => { try { term.kill(); } catch { /* ignore */ } });
    ws.on("error", () => { try { term.kill(); } catch { /* ignore */ } });
  });

  return {
    close: async () => {
      opts.server.off("upgrade", onUpgrade);
      for (const term of tracked) {
        try { term.kill(); } catch { /* ignore */ }
      }
      tracked.clear();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
