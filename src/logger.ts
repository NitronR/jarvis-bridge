// Dual-sink logger: writes every log line to stderr (visible in the terminal
// even when stdout is redirected) AND appends to a file at <systemDir>/logs/
// gateway.log when file logging is enabled.
//
// We override the global `console` methods (info/log/warn/error) so existing
// `console.log("[MODEL] ...")` call sites get dual-sink behavior for free
// without needing to import a wrapper. The file path comes from
// `initLogger({ logFile })` — typically called once from src/index.ts after
// config is loaded.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

let logFilePath: string | undefined;
let writeQueue: Promise<void> = Promise.resolve();

export function initLogger(opts: { logFile?: string }): void {
  logFilePath = opts.logFile;
  if (!logFilePath) return;
  // Best-effort eager mkdir so the first log line doesn't race.
  fsp.mkdir(path.dirname(logFilePath), { recursive: true }).catch(() => {});
}

function enqueue(line: string): void {
  if (!logFilePath) return;
  writeQueue = writeQueue.then(
    () => new Promise<void>((resolve) => {
      fs.appendFile(logFilePath!, line + "\n", () => resolve());
    }),
  ).catch(() => {});
}

function format(args: unknown[]): string {
  return args.map((a) => typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(" ");
}

const orig = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

export function installConsoleOverride(): void {
  const wrap = (level: string, original: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      const ts = new Date().toISOString();
      const line = `[${ts}] ${level} ${format(args)}`;
      process.stderr.write(line + "\n");
      enqueue(line);
      // Skip the original console.* call — we already wrote to stderr.
      // Keeping the original would double-print. (For `debug` we suppress
      // stderr in production, but for now mirror everything.)
      void original;
    };
  console.log = wrap("INFO ", orig.log) as typeof console.log;
  console.info = wrap("INFO ", orig.info) as typeof console.info;
  console.warn = wrap("WARN ", orig.warn) as typeof console.warn;
  console.error = wrap("ERROR", orig.error) as typeof console.error;
  console.debug = wrap("DEBUG", orig.debug) as typeof console.debug;
}
