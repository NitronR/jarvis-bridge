// Frontend → backend log forwarder. Installs a console.* override in the
// browser that mirrors every line to the terminal (the real console) AND
// batches them into POST /chat/client-logs. The server appends them to a
// dedicated frontend.log file (separate from gateway.log so you can grep
// one without the other).
//
// `installClientLogger()` is idempotent and safe to call multiple times
// (e.g. under React StrictMode double-invoke). The forwarder swallows its
// own errors so a failing log pipe never crashes the UI.

const ENDPOINT = "/chat/client-logs";
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH = 50;

type Level = "log" | "info" | "warn" | "error" | "debug";
type Entry = { ts: string; level: Level; args: string };

let installed = false;
let buffer: Entry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: batch }),
    });
  } catch {
    // Drop on failure. Re-queue at most the last MAX_BATCH to avoid
    // unbounded memory growth if the server is unreachable.
    buffer = batch.concat(buffer).slice(-MAX_BATCH * 4);
  }
}

export function installClientLogger(): void {
  if (installed) return;
  installed = true;

  const wrap = (level: Level, original: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      original(...args);
      buffer.push({ ts: new Date().toISOString(), level, args: format(args) });
      if (buffer.length >= MAX_BATCH) void flush();
    };

  console.log = wrap("log", console.log.bind(console));
  console.info = wrap("info", console.info.bind(console));
  console.warn = wrap("warn", console.warn.bind(console));
  console.error = wrap("error", console.error.bind(console));
  console.debug = wrap("debug", console.debug.bind(console));

  timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  window.addEventListener("beforeunload", () => void flush());
}
