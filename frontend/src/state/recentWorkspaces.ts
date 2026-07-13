export const RECENT_WORKSPACES_KEY = "jarvis.recentWorkspaces";
const LEGACY_LAST_WORKSPACE_KEY = "jarvis.lastWorkspace";

function safeGet(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // ignore (storage may be unavailable in test environments)
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadRecentWorkspaces(): string[] {
  if (typeof window === "undefined") return [];
  const raw = safeGet(RECENT_WORKSPACES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // fall through to legacy migration
    }
  }
  const legacy = safeGet(LEGACY_LAST_WORKSPACE_KEY);
  if (legacy) {
    safeSet(RECENT_WORKSPACES_KEY, JSON.stringify([legacy]));
    safeRemove(LEGACY_LAST_WORKSPACE_KEY);
    return [legacy];
  }
  return [];
}

export function pushRecentWorkspace(cwd: string): string[] {
  if (typeof window === "undefined") return [cwd];
  const current = loadRecentWorkspaces().filter((p) => p !== cwd);
  const next = [cwd, ...current];
  safeSet(RECENT_WORKSPACES_KEY, JSON.stringify(next));
  safeRemove(LEGACY_LAST_WORKSPACE_KEY);
  return next;
}