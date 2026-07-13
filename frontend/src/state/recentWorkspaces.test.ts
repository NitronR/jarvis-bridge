import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadRecentWorkspaces, pushRecentWorkspace, RECENT_WORKSPACES_KEY } from "./recentWorkspaces";

describe("recentWorkspaces", () => {
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
    expect(loadRecentWorkspaces()).toEqual([]);
  });

  it("migrates a legacy jarvis.lastWorkspace value into the new list", () => {
    localStorage.setItem("jarvis.lastWorkspace", "/home/user/proj/api");
    expect(loadRecentWorkspaces()).toEqual(["/home/user/proj/api"]);
  });

  it("reads existing jarvis.recentWorkspaces JSON", () => {
    localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(["/a", "/b"]));
    expect(loadRecentWorkspaces()).toEqual(["/a", "/b"]);
  });

  it("ignores malformed JSON in jarvis.recentWorkspaces", () => {
    localStorage.setItem(RECENT_WORKSPACES_KEY, "not-json");
    localStorage.setItem("jarvis.lastWorkspace", "/legacy");
    expect(loadRecentWorkspaces()).toEqual(["/legacy"]);
  });

  it("filters non-string entries out of the stored list", () => {
    localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(["/a", 7, null, "/b"]));
    expect(loadRecentWorkspaces()).toEqual(["/a", "/b"]);
  });

  it("pushRecentWorkspace prepends a new path", () => {
    pushRecentWorkspace("/a");
    pushRecentWorkspace("/b");
    expect(loadRecentWorkspaces()).toEqual(["/b", "/a"]);
  });

  it("pushRecentWorkspace moves an existing path to the front (dedupe)", () => {
    pushRecentWorkspace("/a");
    pushRecentWorkspace("/b");
    pushRecentWorkspace("/c");
    pushRecentWorkspace("/a");
    expect(loadRecentWorkspaces()).toEqual(["/a", "/c", "/b"]);
  });

  it("loadRecentWorkspaces migrates the legacy lastWorkspace key into the new key and removes the legacy", () => {
    store.set("jarvis.lastWorkspace", "/legacy");
    expect(loadRecentWorkspaces()).toEqual(["/legacy"]);
    expect(store.has("jarvis.lastWorkspace")).toBe(false);
    expect(store.get(RECENT_WORKSPACES_KEY)).toBe(JSON.stringify(["/legacy"]));
  });
});