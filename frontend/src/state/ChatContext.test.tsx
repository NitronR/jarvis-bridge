import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { ChatProvider, useChatContext } from "./ChatContext";
import * as client from "../api/client";
import type { ChatInitResponse } from "../api/types";

const baseInit: ChatInitResponse = {
  ok: true,
  backend: { kind: "fake", role: "chat", model: null },
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
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  model: { supported: false, available: [], current: null },
};

describe("ChatContext", () => {
  let fetchJSONSpy: ReturnType<typeof vi.spyOn>;
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
});
