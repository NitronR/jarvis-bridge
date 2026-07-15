import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { ChatProvider, useChatContext } from "./ChatContext";
import * as client from "../api/client";
import type { ChatInitResponse } from "../api/types";

const baseInit: ChatInitResponse = {
  ok: true,
  backend: { kind: "fake", role: "chat", model: null, name: "fake" },
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  resumed: false,
  capabilities: {
    multipleSessions: true,
    customWorkingDirectory: false,
    cancel: true,
    steer: false,
    toolApprovals: true,
    slashCommands: false,
    canFork: true,
    images: false,
    sessionDelete: false,
    promptQueueing: false,
  },
  slashCommands: [],
  history: [],
  customTitle: null,
  pinned: false,
  group: null,
  lastUsage: null,
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  model: { supported: false, available: [], current: null },
};

describe("ChatContext", () => {
  let fetchJSONSpy: MockInstance<typeof client.fetchJSON>;
  beforeEach(() => { fetchJSONSpy = vi.spyOn(client, "fetchJSON"); });
  afterEach(() => { fetchJSONSpy.mockRestore(); vi.restoreAllMocks(); });

  it("init sets session + cwd + capabilities", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.sessionId).toBe("sess-1");
    expect(result.current.state.cwd).toBe("/tmp/ws");
    expect(result.current.state.capabilities?.canFork).toBe(true);
  });

  it("init restores a persisted customTitle from the server", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: { ...baseInit, customTitle: "My saved title" } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.title).toBe("My saved title");
  });

  it("init falls back to 'New chat' when no customTitle is set", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.title).toBe("New chat");
  });

  it("init with explicit sessionId calls /chat/init?sessionId=", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: { ...baseInit, sessionId: "pinned" } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init("pinned"); });
    expect(fetchJSONSpy).toHaveBeenCalledWith("/chat/init?sessionId=pinned");
    expect(result.current.state.sessionId).toBe("pinned");
  });

  it("init handles error response", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: false, status: 500, data: { error: "boom" } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChatProvider>{children}</ChatProvider>
    );
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await act(async () => { await result.current.init(); });
    expect(result.current.state.sessionId).toBeNull();
  });

  describe("turnCounts (session message count)", () => {
    async function withLocalStorage<T>(store: Map<string, string>, fn: () => T | Promise<T>): Promise<T> {
      const mock: Storage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
      };
      const desc = Object.getOwnPropertyDescriptor(window, "localStorage")!;
      Object.defineProperty(window, "localStorage", { value: mock, configurable: true, writable: true });
      try { return await fn(); } finally {
        Object.defineProperty(window, "localStorage", desc);
      }
    }

    const history = (n: number) => Array.from({ length: n }, (_, i) =>
      i % 2 === 0
        ? ({ kind: "user", content: `u${i}` } as const)
        : ({ kind: "assistant", patches: [] } as const),
    );

    it("init records history.length into getTurnCount and persists to localStorage", async () => {
      const store = new Map<string, string>();
      await withLocalStorage(store, async () => {
        fetchJSONSpy.mockResolvedValue({
          ok: true, status: 200, data: { ...baseInit, history: history(7) },
        });
        const wrapper = ({ children }: { children: ReactNode }) => (
          <ChatProvider>{children}</ChatProvider>
        );
        const { result } = renderHook(() => useChatContext(), { wrapper });

        await act(async () => { await result.current.init("sess-1"); });
        expect(result.current.getTurnCount("sess-1")).toBe(7);
        expect(JSON.parse(store.get("jarvis.turnCounts") || "null")).toEqual({ "sess-1": 7 });
      });
    });

    it("init with empty history writes 0 (drawer decides to suppress the pill)", async () => {
      const store = new Map<string, string>();
      await withLocalStorage(store, async () => {
        fetchJSONSpy.mockResolvedValue({
          ok: true, status: 200, data: { ...baseInit, history: [] },
        });
        const wrapper = ({ children }: { children: ReactNode }) => (
          <ChatProvider>{children}</ChatProvider>
        );
        const { result } = renderHook(() => useChatContext(), { wrapper });
        await act(async () => { await result.current.init("sess-1"); });
        expect(result.current.getTurnCount("sess-1")).toBe(0);
      });
    });

    it("hydrates getTurnCount from localStorage on mount without any init() call", async () => {
      const store = new Map<string, string>([["jarvis.turnCounts", JSON.stringify({ abc: 3 })]]);
      await withLocalStorage(store, async () => {
        const wrapper = ({ children }: { children: ReactNode }) => (
          <ChatProvider>{children}</ChatProvider>
        );
        const { result } = renderHook(() => useChatContext(), { wrapper });
        expect(result.current.getTurnCount("abc")).toBe(3);
        expect(result.current.getTurnCount("nope")).toBeUndefined();
      });
    });

    it("pruneTurnCounts keeps only the listed ids and rewrites localStorage", async () => {
      const store = new Map<string, string>([["jarvis.turnCounts", JSON.stringify({ abc: 3, def: 5 })]]);
      await withLocalStorage(store, async () => {
        const wrapper = ({ children }: { children: ReactNode }) => (
          <ChatProvider>{children}</ChatProvider>
        );
        const { result } = renderHook(() => useChatContext(), { wrapper });
        act(() => { result.current.pruneTurnCounts(new Set(["abc"])); });
        expect(result.current.getTurnCount("abc")).toBe(3);
        expect(result.current.getTurnCount("def")).toBeUndefined();
        expect(JSON.parse(store.get("jarvis.turnCounts") || "null")).toEqual({ abc: 3 });
      });
    });

    it("reset() does not clear turnCounts", async () => {
      const store = new Map<string, string>();
      await withLocalStorage(store, async () => {
        fetchJSONSpy.mockResolvedValue({
          ok: true, status: 200, data: { ...baseInit, history: history(4) },
        });
        const wrapper = ({ children }: { children: ReactNode }) => (
          <ChatProvider>{children}</ChatProvider>
        );
        const { result } = renderHook(() => useChatContext(), { wrapper });
        await act(async () => { await result.current.init("sess-1"); });
        expect(result.current.getTurnCount("sess-1")).toBe(4);
        act(() => { result.current.reset(); });
        expect(result.current.getTurnCount("sess-1")).toBe(4);
      });
    });

    it("survives corrupt localStorage without throwing", async () => {
      const store = new Map<string, string>([["jarvis.turnCounts", "not-json{"]]);
      await withLocalStorage(store, async () => {
        const wrapper = ({ children }: { children: ReactNode }) => (
          <ChatProvider>{children}</ChatProvider>
        );
        const { result } = renderHook(() => useChatContext(), { wrapper });
        expect(result.current.getTurnCount("anything")).toBeUndefined();
      });
    });
  });
});
