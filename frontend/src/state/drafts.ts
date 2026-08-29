export const DRAFTS_KEY = "jarvis.drafts";

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
    // ignore (storage may be unavailable in test environments)
  }
}

function loadDrafts(): Record<string, string> {
  const raw = safeGet(DRAFTS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(drafts: Record<string, string>): void {
  if (Object.keys(drafts).length === 0) safeRemove(DRAFTS_KEY);
  else safeSet(DRAFTS_KEY, JSON.stringify(drafts));
}

export function loadDraft(sessionId: string | null): string {
  if (typeof window === "undefined" || !sessionId) return "";
  return loadDrafts()[sessionId] ?? "";
}

// An empty (or whitespace-only) draft is stored as no draft at all, so ended
// conversations don't leave dead entries behind.
export function saveDraft(sessionId: string | null, text: string): void {
  if (typeof window === "undefined" || !sessionId) return;
  const drafts = loadDrafts();
  if (text.trim()) drafts[sessionId] = text;
  else delete drafts[sessionId];
  persist(drafts);
}

export function pruneDrafts(keepIds: Set<string>): void {
  if (typeof window === "undefined") return;
  const drafts = loadDrafts();
  let changed = false;
  for (const id of Object.keys(drafts)) {
    if (!keepIds.has(id)) {
      delete drafts[id];
      changed = true;
    }
  }
  if (changed) persist(drafts);
}
