// Native macOS folder picker. Shells out to osascript's "choose folder"
// dialog and returns a real absolute path — something a browser-side folder
// picker cannot do, since browsers deliberately withhold real filesystem
// paths from JS. Only meaningful on darwin; callers gate on
// process.platform before invoking this.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

export type PickFolderResult = { cancelled: boolean; cwd: string | null };
export type PickFolderFn = (initialCwd?: string) => Promise<PickFolderResult>;

function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildChooseFolderScript(initialCwd?: string): string {
  let inner = 'choose folder with prompt "Select a workspace folder"';
  if (initialCwd) {
    inner += ` default location (POSIX file "${escapeAppleScriptString(initialCwd)}")`;
  }
  return `POSIX path of (${inner})`;
}

export const pickFolderNative: PickFolderFn = async (initialCwd) => {
  let effectiveInitialCwd: string | undefined;
  if (initialCwd) {
    const stat = await fs.stat(initialCwd).catch(() => null);
    if (stat?.isDirectory()) effectiveInitialCwd = initialCwd;
  }
  const script = buildChooseFolderScript(effectiveInitialCwd);
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return { cancelled: false, cwd: stdout.trim() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("-128") || /user canceled/i.test(message)) {
      return { cancelled: true, cwd: null };
    }
    throw err;
  }
};
