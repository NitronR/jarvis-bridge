export const QUICK_PHRASES_KEY = "jarvis.quickPhrases";

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

export function loadQuickPhrases(): string[] {
  if (typeof window === "undefined") return [];
  const raw = safeGet(QUICK_PHRASES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function saveQuickPhrases(phrases: string[]): void {
  if (typeof window === "undefined") return;
  safeSet(QUICK_PHRASES_KEY, JSON.stringify(phrases));
}
