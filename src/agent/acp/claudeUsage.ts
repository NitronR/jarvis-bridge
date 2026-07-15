// Fetches subscription rate-limit windows via a one-off `claude --print
// "/usage"` CLI invocation — a separate, independent process from the
// long-lived ACP subprocess this backend already talks to over JSON-RPC.
//
// Why this exists: the passive `usage_update._meta["_claude/rateLimit"]`
// notification (see mapping.ts's `rateLimitFromMeta`) often omits
// `utilization` entirely (confirmed via live traffic — see
// docs/agent-claude-code.md §6). The CLI's own `/usage` slash command always
// renders a percentage, so shelling out to it on demand is the only reliable
// source of utilization today, short of patching the upstream
// `claude-agent-acp` adapter to forward the SDK's richer `get_usage` control
// API (also documented there, deliberately not pursued).

import { execFile as execFileCb } from "node:child_process";
import type { RateLimitWindow, UsageTotals } from "../types";

// `Current session: 82% used · resets Jul 15 at 2pm (Asia/Calcutta)`
const SESSION_RE = /Current session:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\n]+))?/i;
// `Current week (all models): 7% used · resets Jul 22 at 2:30am (Asia/Calcutta)`
const WEEK_RE = /Current week \(all models\):\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\n]+))?/i;

// The CLI's text output has no discrete status field (unlike the structured
// rate_limit_event, which has status: allowed/allowed_warning/rejected) — this
// approximates one from the percentage using the same 80% threshold InfoPanel
// already uses for its warning color. Not authoritative; good enough to pick
// a status word when nothing else is available.
function statusFromPct(pct: number): RateLimitWindow["status"] {
  if (pct >= 100) return "rejected";
  if (pct >= 80) return "allowed_warning";
  return "allowed";
}

function windowFromMatch(m: RegExpMatchArray | null): RateLimitWindow | null {
  if (!m) return null;
  const pct = Number(m[1]);
  if (!Number.isFinite(pct)) return null;
  const window: RateLimitWindow = { status: statusFromPct(pct), utilization: pct / 100 };
  const resetsText = m[2]?.trim();
  if (resetsText) window.resetsAtText = resetsText;
  return window;
}

// Parses the plain-text `result` field from `claude --print --output-format
// json "/usage"` into the same per-window shape the passive event fills in.
// Exported standalone (no process spawning) so it's cheaply unit-testable
// against real captured output.
export function parseClaudeUsageText(text: string): UsageTotals["rate_limits"] | null {
  const five_hour = windowFromMatch(text.match(SESSION_RE));
  const seven_day = windowFromMatch(text.match(WEEK_RE));
  if (!five_hour && !seven_day) return null;
  const out: Record<string, RateLimitWindow> = {};
  if (five_hour) out.five_hour = five_hour;
  if (seven_day) out.seven_day = seven_day;
  return out;
}

export interface ExecFileResult {
  stdout: string;
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<ExecFileResult>;

const defaultExecFile: ExecFileFn = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFileCb(file, args as string[], opts, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout: stdout.toString() });
    });
  });

export interface QueryClaudeUsageOptions {
  executable: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  // Injectable for tests — defaults to the real child_process.execFile.
  execFile?: ExecFileFn;
}

export async function queryClaudeUsageViaCli(
  opts: QueryClaudeUsageOptions,
): Promise<UsageTotals["rate_limits"] | null> {
  const exec = opts.execFile ?? defaultExecFile;
  const { stdout } = await exec(opts.executable, ["--print", "--output-format", "json", "/usage"], {
    cwd: opts.cwd,
    env: opts.env,
    timeout: 20_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("claude --print returned non-JSON output");
  }
  const result = (parsed as { result?: unknown } | null)?.result;
  if (typeof result !== "string") {
    throw new Error("claude --print response had no text result");
  }
  return parseClaudeUsageText(result);
}
