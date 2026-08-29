import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadDraft, saveDraft, pruneDrafts, DRAFTS_KEY } from "./drafts";

describe("drafts", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty string when nothing is stored", () => {
    expect(loadDraft("s1")).toBe("");
  });

  it("round-trips a draft per session", () => {
    saveDraft("s1", "hello there");
    saveDraft("s2", "other chat");
    expect(loadDraft("s1")).toBe("hello there");
    expect(loadDraft("s2")).toBe("other chat");
  });

  it("preserves leading/trailing whitespace so the caret position survives", () => {
    saveDraft("s1", "half a sentence ");
    expect(loadDraft("s1")).toBe("half a sentence ");
  });

  it("deletes the entry when the draft becomes empty", () => {
    saveDraft("s1", "typed");
    saveDraft("s2", "kept");
    saveDraft("s1", "");
    expect(loadDraft("s1")).toBe("");
    expect(loadDraft("s2")).toBe("kept");
  });

  it("treats a whitespace-only draft as empty", () => {
    saveDraft("s1", "   \n ");
    expect(loadDraft("s1")).toBe("");
  });

  it("removes the storage key entirely once the last draft is gone", () => {
    saveDraft("s1", "typed");
    saveDraft("s1", "");
    expect(store.has(DRAFTS_KEY)).toBe(false);
  });

  it("is a no-op without a session id", () => {
    saveDraft(null, "orphan");
    expect(store.has(DRAFTS_KEY)).toBe(false);
    expect(loadDraft(null)).toBe("");
  });

  it("ignores malformed JSON", () => {
    store.set(DRAFTS_KEY, "not-json");
    expect(loadDraft("s1")).toBe("");
  });

  it("ignores non-string values in the stored map", () => {
    store.set(DRAFTS_KEY, JSON.stringify({ s1: 7, s2: "ok" }));
    expect(loadDraft("s1")).toBe("");
    expect(loadDraft("s2")).toBe("ok");
  });

  it("ignores a stored array", () => {
    store.set(DRAFTS_KEY, JSON.stringify(["a", "b"]));
    expect(loadDraft("s1")).toBe("");
  });

  it("prunes drafts for sessions that no longer exist", () => {
    saveDraft("s1", "keep me");
    saveDraft("s2", "drop me");
    pruneDrafts(new Set(["s1"]));
    expect(loadDraft("s1")).toBe("keep me");
    expect(loadDraft("s2")).toBe("");
  });

  it("leaves storage untouched when every draft is still live", () => {
    saveDraft("s1", "keep me");
    const before = store.get(DRAFTS_KEY);
    pruneDrafts(new Set(["s1", "s2"]));
    expect(store.get(DRAFTS_KEY)).toBe(before);
  });
});
