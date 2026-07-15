import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadQuickPhrases, saveQuickPhrases, QUICK_PHRASES_KEY } from "./quickPhrases";

describe("quickPhrases", () => {
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

  it("returns an empty list when nothing is stored", () => {
    expect(loadQuickPhrases()).toEqual([]);
  });

  it("round-trips a saved list", () => {
    saveQuickPhrases(["ping the team", "run tests"]);
    expect(loadQuickPhrases()).toEqual(["ping the team", "run tests"]);
    expect(store.get(QUICK_PHRASES_KEY)).toBe(JSON.stringify(["ping the team", "run tests"]));
  });

  it("ignores malformed JSON", () => {
    store.set(QUICK_PHRASES_KEY, "not-json");
    expect(loadQuickPhrases()).toEqual([]);
  });

  it("filters non-string entries out of the stored list", () => {
    store.set(QUICK_PHRASES_KEY, JSON.stringify(["a", 7, null, "b"]));
    expect(loadQuickPhrases()).toEqual(["a", "b"]);
  });
});
