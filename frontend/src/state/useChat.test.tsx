import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { ChatProvider } from "./ChatContext";
import { useChat } from "./useChat";
import * as client from "../api/client";
import type { ChatInitResponse, ChatPatch } from "../api/types";

const baseInit: ChatInitResponse = {
  ok: true,
  backend: { kind: "fake", role: "chat", model: null, name: "fake" },
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  resumed: false,
  capabilities: {
    multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false,
    toolApprovals: true, slashCommands: false, canFork: true, images: false,
    sessionDelete: false, promptQueueing: false,
  },
  slashCommands: [], history: [],
  customTitle: null,
  pinned: false,
  group: null,
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  model: { supported: false, available: [], current: null },
};

function wrapperWithChat({ children }: { children: ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}

describe("useChat", () => {
  let fetchJSONSpy: MockInstance<typeof client.fetchJSON>;
  let fetchSSESpy: MockInstance<typeof client.fetchSSE>;

  beforeEach(() => { fetchJSONSpy = vi.spyOn(client, "fetchJSON"); });
  afterEach(() => { fetchSSESpy?.mockRestore(); fetchJSONSpy.mockRestore(); vi.restoreAllMocks(); });

  it("exposes the underlying ChatContext state", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    expect(result.current.context.state.sessionId).toBe("sess-1");
    expect(result.current.busy).toBe(false);
  });

  it("sendMessage collects patches into transcript", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const patches: ChatPatch[] = [
      { type: "text-start", index: 0, content: "hi" },
      { type: "text-delta", index: 0, delta: "!" },
      { type: "done" },
    ];
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockImplementation((_url, _body, handlers) => {
      Promise.resolve().then(() => {
        for (const p of patches) handlers.onPatch(p);
        handlers.onDone?.();
      });
      return { abort: vi.fn(), done: Promise.resolve() };
    });

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    await act(async () => { await result.current.sendMessage("hello"); });
    expect(result.current.transcript).toHaveLength(2);
    expect(result.current.transcript[0]).toEqual({ role: "user", text: "hello" });
    expect(result.current.transcript[1].role).toBe("assistant");
    if (result.current.transcript[1].role === "assistant") {
      expect(result.current.transcript[1].patches).toHaveLength(3);
    }
  });

  it("cancel aborts the stream", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const abortFn = vi.fn();
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockReturnValue({
      abort: abortFn,
      done: new Promise(() => {}),
    });
    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    await act(async () => { await result.current.sendMessage("hi"); });
    act(() => result.current.cancel());
    expect(abortFn).toHaveBeenCalled();
  });
});
