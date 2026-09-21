import { spawn } from "node:child_process";
import type { RateLimitWindow, UsageTotals } from "../types";

interface CodexRateLimitWindow {
  usedPercent?: unknown;
  used_percent?: unknown;
  resetsAt?: unknown;
  resets_at?: unknown;
  windowDurationMins?: unknown;
  window_duration_mins?: unknown;
}

interface CodexRateLimits {
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function statusFromPct(pct: number): RateLimitWindow["status"] {
  if (pct >= 100) return "rejected";
  if (pct >= 80) return "allowed_warning";
  return "allowed";
}

function windowKey(kind: "primary" | "secondary", mins: number | undefined): string {
  if (mins === 10_080) return "seven_day";
  if (mins === 180) return "three_hour";
  if (mins === 300) return "five_hour";
  if (mins && mins > 0 && mins % 60 === 0) return `${mins / 60}_hour`;
  return kind === "primary" ? "primary" : "secondary";
}

function parseWindow(value: CodexRateLimitWindow | undefined): RateLimitWindow | null {
  if (!value) return null;
  const pct = finiteNumber(value.usedPercent ?? value.used_percent);
  if (pct === undefined) return null;
  const utilization = Math.min(100, Math.max(0, pct)) / 100;
  const resetSeconds = finiteNumber(value.resetsAt ?? value.resets_at);
  return {
    status: statusFromPct(utilization * 100),
    utilization,
    ...(resetSeconds !== undefined ? { resetsAt: resetSeconds * 1000 } : {}),
  };
}

// Normalizes Codex app-server's account/rateLimits/read payload into the
// provider-neutral shape used by the existing Usage panel.
export function parseCodexRateLimits(value: CodexRateLimits): UsageTotals["rate_limits"] | null {
  const out: Record<string, RateLimitWindow> = {};
  for (const kind of ["primary", "secondary"] as const) {
    const raw = value[kind];
    const parsed = parseWindow(raw);
    if (!parsed) continue;
    const mins = finiteNumber(raw?.windowDurationMins ?? raw?.window_duration_mins);
    out[windowKey(kind, mins)] = parsed;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface QueryCodexUsageOptions {
  executable: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  // Injectable process boundary for tests. It must return the raw result of
  // Codex app-server's account/rateLimits/read request.
  readRateLimits?: (opts: Omit<QueryCodexUsageOptions, "readRateLimits">) => Promise<unknown>;
}

export async function queryCodexUsageViaAppServer(
  opts: QueryCodexUsageOptions,
): Promise<UsageTotals["rate_limits"] | null> {
  const readRateLimits = opts.readRateLimits ?? readRateLimitsFromAppServer;
  const raw = await readRateLimits(opts);
  const envelope = raw as {
    rateLimits?: unknown;
    rateLimitsByLimitId?: Record<string, unknown>;
  } | null;
  const rateLimits = (
    envelope?.rateLimits ?? envelope?.rateLimitsByLimitId?.codex ?? raw
  ) as CodexRateLimits;
  return parseCodexRateLimits(rateLimits);
}

async function readRateLimitsFromAppServer(
  opts: Omit<QueryCodexUsageOptions, "readRateLimits">,
): Promise<unknown> {
  const child = spawn(opts.executable, [...(opts.args ?? []), "app-server"], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    // Adapter/npx launchers spawn descendants; isolate this usage query so
    // shutdown also terminates its app-server, without touching chat agents.
    detached: process.platform !== "win32",
  });
  child.stderr?.resume();
  child.stdin?.on("error", (err) => fail(err));
  const request = (method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let buffer = "";
  const fail = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let lineEnd: number;
    while ((lineEnd = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      try {
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (typeof message.id !== "number") continue;
        const entry = pending.get(message.id);
        if (!entry) continue;
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message ?? "Codex app-server request failed"));
        else entry.resolve(message.result);
      } catch {
        // Codex may write diagnostic text to stdout; only JSON-RPC lines matter.
      }
    }
  });
  child.once("error", (err) => fail(err));
  child.once("exit", () => fail(new Error("Codex app-server exited before returning usage")));

  const timeout = setTimeout(() => fail(new Error("Codex app-server usage query timed out")), 20_000);
  try {
    await request("initialize", {
      clientInfo: { name: "jarvis-bridge", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
    return await request("account/rateLimits/read", {});
  } finally {
    clearTimeout(timeout);
    child.stdin?.end();
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      }
    } else {
      child.kill();
    }
  }
}
