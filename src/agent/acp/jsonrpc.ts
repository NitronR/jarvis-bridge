// JSON-RPC 2.0 client over newline-delimited JSON on a child's stdio.
// Tolerant of interleaved non-JSON log lines on stdout (per ACP agents).

import { spawn as nodeSpawn, ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class AcpRequestError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "AcpRequestError";
    this.code = code;
    this.data = data;
  }
}

export class AcpConnectionClosedError extends Error {
  constructor(message = "agent connection closed") {
    super(message);
    this.name = "AcpConnectionClosedError";
  }
}

export interface AcpSpawnOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  stderrLogPath?: string;
  env?: NodeJS.ProcessEnv;
}

type RequestHandler = (params: unknown) => Promise<unknown> | unknown;
type NotificationHandler = (params: unknown) => void | Promise<void>;
type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

interface IncomingRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

interface IncomingNotification {
  method: string;
  params?: unknown;
}

interface IncomingResponse {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type Envelope =
  | (IncomingRequest & { jsonrpc: "2.0" })
  | (IncomingNotification & { jsonrpc: "2.0" })
  | (IncomingResponse & { jsonrpc: "2.0" });

export class AcpConnection {
  private child: ChildProcess;
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private requestHandlers = new Map<string, RequestHandler>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private exitListeners = new Set<ExitListener>();
  private buffer = "";
  private _isClosed = false;

  private constructor(child: ChildProcess, _stderrLogPath?: string) {
    this.child = child;

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.feed(chunk));
    }
    if (child.stderr) {
      // stderr is already piped to a log file (or drained) by spawn().
      // We don't decode it into messages.
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (this._isClosed) return;
      this._isClosed = true;
      const err = new AcpConnectionClosedError(
        `agent subprocess exited (code=${code}, signal=${signal})`,
      );
      for (const [, p] of this.pending) {
        p.reject(err);
      }
      this.pending.clear();
      for (const listener of this.exitListeners) {
        try {
          listener(code, signal);
        } catch {
          /* swallow */
        }
      }
    };
    child.on("exit", onExit);
    child.on("error", (err) => {
      if (this._isClosed) return;
      this._isClosed = true;
      for (const [, p] of this.pending) {
        p.reject(err);
      }
      this.pending.clear();
    });
  }

  static async spawn(opts: AcpSpawnOptions): Promise<AcpConnection> {
    let stderrStream: NodeJS.WritableStream | null = null;
    if (opts.stderrLogPath) {
      try {
        mkdirSync(dirname(opts.stderrLogPath), { recursive: true });
        stderrStream = createWriteStream(opts.stderrLogPath, { flags: "a" });
      } catch {
        stderrStream = null;
      }
    }
    const child = nodeSpawn(opts.command, [...opts.args], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (stderrStream && child.stderr) {
      child.stderr.pipe(stderrStream);
    } else if (child.stderr) {
      child.stderr.resume();
    }
    return new AcpConnection(child, opts.stderrLogPath);
  }

  get isClosed(): boolean {
    return this._isClosed;
  }

  sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this._isClosed) {
      return Promise.reject(new AcpConnectionClosedError());
    }
    const id = this.nextId++;
    const envelope = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(String(id), {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.writeLine(JSON.stringify(envelope));
    });
  }

  async sendNotification(method: string, params?: unknown): Promise<void> {
    if (this._isClosed) return;
    const envelope = { jsonrpc: "2.0", method, params };
    this.writeLine(JSON.stringify(envelope));
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  onExit(listener: ExitListener): void {
    this.exitListeners.add(listener);
  }

  close(): Promise<void> {
    if (this._isClosed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      // End stdin; then kill if needed.
      try {
        this.child.stdin?.end();
      } catch {
        /* ignore */
      }
      const finalize = () => {
        if (!this._isClosed) {
          this._isClosed = true;
          for (const [, p] of this.pending) {
            p.reject(new AcpConnectionClosedError());
          }
          this.pending.clear();
        }
        resolve();
      };
      this.child.once("exit", finalize);
      // Force-kill after a short grace period if still running.
      setTimeout(() => {
        if (!this._isClosed) {
          try {
            this.child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        }
      }, 200);
    });
  }

  // ── internal ──────────────────────────────────────────────────────────

  private writeLine(line: string): void {
    try {
      this.child.stdin?.write(line + "\n");
    } catch {
      // Subprocess closed stdin; treat as connection closed.
      this._isClosed = true;
    }
  }

  private feed(chunk: string): void {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    if (!line) return;
    let env: Envelope;
    try {
      const parsed = JSON.parse(line);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as { jsonrpc?: unknown }).jsonrpc !== "2.0"
      ) {
        return; // tolerate non-JSON / non-2.0 log lines
      }
      env = parsed as Envelope;
    } catch {
      return; // tolerate garbage lines
    }

    // Incoming response (has id, no method): resolve/reject pending request.
    if ("id" in env && !(env as IncomingRequest).method) {
      const resp = env as IncomingResponse;
      const key = String(resp.id);
      const p = this.pending.get(key);
      if (!p) return; // late response for a request we already gave up on
      this.pending.delete(key);
      if (resp.error) {
        p.reject(new AcpRequestError(resp.error.code, resp.error.message, resp.error.data));
      } else {
        p.resolve(resp.result);
      }
      return;
    }

    // Incoming request (has id AND method): server→client. Reply with handler result.
    if ("id" in env && (env as IncomingRequest).method) {
      const req = env as IncomingRequest;
      const handler = this.requestHandlers.get(req.method);
      if (!handler) {
        this.writeLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32601, message: "method not found" },
          }),
        );
        return;
      }
      Promise.resolve()
        .then(() => handler(req.params))
        .then((result) => {
          this.writeLine(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
        })
        .catch((err: Error) => {
          this.writeLine(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: -32603, message: err?.message ?? "internal error" },
            }),
          );
        });
      return;
    }

    // Incoming notification (has method, no id).
    if ((env as IncomingNotification).method) {
      const note = env as IncomingNotification;
      const handler = this.notificationHandlers.get(note.method);
      if (!handler) return;
      Promise.resolve()
        .then(() => handler(note.params))
        .catch(() => {
          /* swallow handler errors */
        });
      return;
    }
  }
}