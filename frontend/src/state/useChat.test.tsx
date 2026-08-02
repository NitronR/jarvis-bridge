import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { ChatProvider } from "./ChatContext";
import { useChat, type TranscriptEntry } from "./useChat";
import * as client from "../api/client";
import type { ChatInitResponse, ChatPatch, ImageAttachment } from "../api/types";

type QueuedUserEntry = Extract<TranscriptEntry, { role: "user" }> & { queued: true; queueId: string };

function queuedEntries(transcript: TranscriptEntry[]): QueuedUserEntry[] {
  return transcript.filter(
    (e): e is QueuedUserEntry => e.role === "user" && !!e.queued && !!e.queueId,
  );
}

const baseInit: ChatInitResponse = {
  ok: true,
  backend: { kind: "fake", role: "chat", model: null, name: "fake" },
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  resumed: false,
  activeTurn: false,
  capabilities: {
    multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false,
    toolApprovals: true, slashCommands: false, canFork: true, images: false,
    sessionDelete: false, promptQueueing: false, usageQuery: false,
  },
  slashCommands: [], history: [],
  customTitle: null,
  pinned: false,
  group: null,
  lastUsage: null,
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

  it("reattaches to a live turn via GET /chat/stream when init reports activeTurn", async () => {
    fetchJSONSpy.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ...baseInit,
        activeTurn: true,
        history: [
          { kind: "user", content: "hello" },
          { kind: "assistant", patches: [{ type: "text-delta", index: 0, delta: "partial" }] },
        ],
      },
    });
    const patches: ChatPatch[] = [
      { type: "text-delta", index: 0, delta: "partial" }, // replayed buffer (same as what's already in history)
      { type: "text-delta", index: 0, delta: " more" },    // new live patch
      { type: "done" },
    ];
    let capturedUrl = "";
    let capturedBody: unknown;
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockImplementation((url, body, handlers) => {
      capturedUrl = url;
      capturedBody = body;
      Promise.resolve().then(() => {
        for (const p of patches) handlers.onPatch(p);
        handlers.onDone?.();
      });
      return { abort: vi.fn(), done: Promise.resolve() };
    });

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init("sess-1"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(capturedUrl).toBe("/chat/stream?sessionId=sess-1");
    expect(capturedBody).toBeNull();
    expect(result.current.transcript).toHaveLength(2);
    expect(result.current.transcript[1].role).toBe("assistant");
    if (result.current.transcript[1].role === "assistant") {
      expect(result.current.transcript[1].patches).toHaveLength(3); // reset-then-replayed, not additive with history
    }
  });

  it("switching sessions while merely watching a reattached background turn does not send a real cancel", async () => {
    fetchJSONSpy.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...baseInit, activeTurn: true },
    });
    const abortFn = vi.fn();
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockReturnValue({
      abort: abortFn,
      done: new Promise(() => {}),
    });

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init("sess-1"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.busy).toBe(true); // reattach set busy, but this tab never called sendMessage
    fetchJSONSpy.mockClear();

    await act(async () => { await result.current.switchSession("sess-2"); });

    expect(abortFn).toHaveBeenCalled();
    expect(fetchJSONSpy).not.toHaveBeenCalledWith("/chat/cancel", expect.anything());
  });

  it("switching sessions while a locally-initiated send is in flight still sends a real cancel", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const abortFn = vi.fn();
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockReturnValue({
      abort: abortFn,
      done: new Promise(() => {}),
    });

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    await act(async () => { await result.current.sendMessage("hi"); });

    expect(result.current.busy).toBe(true);
    fetchJSONSpy.mockClear();

    await act(async () => { await result.current.switchSession("sess-2"); });

    expect(abortFn).toHaveBeenCalled();
    expect(fetchJSONSpy).toHaveBeenCalledWith("/chat/cancel", { method: "POST", body: { sessionId: "sess-1" } });
  });

  it("cancel() resets sendingRef so a later reattach-only switch does not send a real cancel", async () => {
    fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
    const abortFn1 = vi.fn();
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockReturnValue({
      abort: abortFn1,
      done: new Promise(() => {}),
    });

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    await act(async () => { await result.current.sendMessage("hi"); });
    expect(result.current.busy).toBe(true);

    // Stop button: aborts the send this tab initiated.
    act(() => result.current.cancel());
    fetchJSONSpy.mockClear();

    // Reattach to a different session's background turn (busy set purely from watching).
    fetchJSONSpy.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...baseInit, sessionId: "sess-2", activeTurn: true },
    });
    const abortFn2 = vi.fn();
    fetchSSESpy.mockReturnValue({ abort: abortFn2, done: new Promise(() => {}) });
    await act(async () => { await result.current.switchSession("sess-2"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.busy).toBe(true);
    fetchJSONSpy.mockClear();

    // Navigating away again must not issue a real /chat/cancel for a turn this tab never started.
    await act(async () => { await result.current.switchSession("sess-3"); });

    expect(abortFn2).toHaveBeenCalled();
    expect(fetchJSONSpy).not.toHaveBeenCalledWith("/chat/cancel", expect.anything());
  });

  it("forkCurrent opens the forked session in a new tab, leaving the current tab on the source session", async () => {
    fetchJSONSpy.mockImplementation(async (url) => {
      if (String(url).startsWith("/chat/sessions/fork")) {
        return { ok: true, status: 200, data: { ok: true, sourceSessionId: "sess-1", sessionId: "sess-2", cwd: "/tmp/ws" } };
      }
      return { ok: true, status: 200, data: baseInit };
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init(); });
    await act(async () => { await result.current.forkCurrent(); });

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("sessionId=sess-2"),
      "_blank",
      "noopener,noreferrer",
    );
    // The current tab's own session must be untouched — no /chat/init refetch
    // for the forked id, since forking must not switch this tab away from
    // the source conversation.
    expect(result.current.context.state.sessionId).toBe("sess-1");
  });

  it("resyncs via /chat/init when the reattach stream errors out (e.g. the turn already finished)", async () => {
    fetchJSONSpy.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...baseInit, activeTurn: true },
    });
    fetchSSESpy = vi.spyOn(client, "fetchSSE").mockImplementation((_url, _body, handlers) => {
      Promise.resolve().then(() => { handlers.onError?.(new Error("404")); });
      return { abort: vi.fn(), done: Promise.resolve() };
    });

    const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
    await act(async () => { await result.current.context.init("sess-1"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.busy).toBe(false);
    expect(fetchJSONSpy).toHaveBeenCalledWith("/chat/init?sessionId=sess-1");
  });

  describe("message queueing", () => {
    // Captures each fetchSSE call's handlers so tests can drive turn
    // completion manually (onDone) and inspect what was sent.
    function manualSSEMock() {
      const calls: {
        url: string;
        body: unknown;
        handlers: { onPatch: (p: ChatPatch) => void; onDone?: () => void; onError?: (e: Error) => void };
      }[] = [];
      fetchSSESpy = vi.spyOn(client, "fetchSSE").mockImplementation((url, body, handlers) => {
        calls.push({ url: String(url), body, handlers });
        return { abort: vi.fn(), done: Promise.resolve() };
      });
      return calls;
    }

    it("renders queued messages in the transcript with a queued flag and lets dequeueMessage remove them", async () => {
      fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
      manualSSEMock();

      const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
      await act(async () => { await result.current.context.init(); });
      await act(async () => { await result.current.sendMessage("first"); });

      act(() => result.current.enqueueMessage("second"));
      act(() => result.current.enqueueMessage("third"));

      const queued = queuedEntries(result.current.transcript);
      expect(queued.map((e) => e.text)).toEqual(["second", "third"]);
      const secondId = queued[0].queueId;
      expect(secondId).toBeTruthy();

      act(() => result.current.dequeueMessage(secondId!));
      expect(result.current.transcript.some((e) => e.role === "user" && e.text === "second")).toBe(false);
      expect(queuedEntries(result.current.transcript)).toHaveLength(1);
    });

    it("keeps streaming the in-flight reply while a queued message sits below it", async () => {
      fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
      const calls = manualSSEMock();

      const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
      await act(async () => { await result.current.context.init(); });
      await act(async () => { await result.current.sendMessage("first"); });

      act(() => result.current.enqueueMessage("second"));
      // The transcript's tail is now the queued user entry, not the streaming
      // reply — patches for the in-flight turn must still land on it instead
      // of being dropped as if the stream had stalled.
      act(() => calls[0].handlers.onPatch({ type: "text-delta", index: 0, delta: " hi" }));
      act(() => calls[0].handlers.onPatch({ type: "text-delta", index: 0, delta: " there" }));

      const assistant = result.current.transcript.find((e) => e.role === "assistant");
      if (assistant?.role === "assistant") {
        expect(assistant.patches).toHaveLength(2);
      }
      expect(queuedEntries(result.current.transcript).map((e) => e.text)).toEqual(["second"]);
    });

    it("drains queued messages one-by-one after the current turn finishes", async () => {
      fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
      const calls = manualSSEMock();

      const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
      await act(async () => { await result.current.context.init(); });
      await act(async () => { await result.current.sendMessage("first"); });
      expect(result.current.busy).toBe(true);

      act(() => result.current.enqueueMessage("second"));
      act(() => result.current.enqueueMessage("third"));
      expect(calls).toHaveLength(1); // only the initial send started so far

      // Current turn completes -> the oldest queued message is sent next.
      await act(async () => { calls[0].handlers.onDone?.(); });
      expect(calls).toHaveLength(2);
      expect((calls[1].body as { message: string }).message).toBe("second");
      expect(result.current.busy).toBe(true);
      const stillQueued = queuedEntries(result.current.transcript);
      expect(stillQueued).toHaveLength(1);
      expect(stillQueued[0].text).toBe("third");

      // Next turn completes -> the remaining queued message is sent.
      await act(async () => { calls[1].handlers.onDone?.(); });
      expect(calls).toHaveLength(3);
      expect((calls[2].body as { message: string }).message).toBe("third");

      await act(async () => { calls[2].handlers.onDone?.(); });
      expect(result.current.busy).toBe(false);
      expect(queuedEntries(result.current.transcript)).toHaveLength(0);
    });

    it("skips a dequeued message and sends the rest of the queue in order", async () => {
      fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
      const calls = manualSSEMock();

      const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
      await act(async () => { await result.current.context.init(); });
      await act(async () => { await result.current.sendMessage("first"); });

      act(() => result.current.enqueueMessage("second"));
      act(() => result.current.enqueueMessage("third"));
      const secondId = queuedEntries(result.current.transcript).find((e) => e.text === "second")?.queueId;
      act(() => result.current.dequeueMessage(secondId!));

      await act(async () => { calls[0].handlers.onDone?.(); });
      expect(calls).toHaveLength(2);
      expect((calls[1].body as { message: string }).message).toBe("third");
    });

    it("sends queued messages with their attachments", async () => {
      fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
      const calls = manualSSEMock();

      const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
      await act(async () => { await result.current.context.init(); });
      await act(async () => { await result.current.sendMessage("first"); });

      const img: ImageAttachment = { data: "abc", mimeType: "image/png", filename: "a.png" };
      act(() => result.current.enqueueMessage("second", [img]));
      expect(queuedEntries(result.current.transcript)[0].images).toEqual([img]);

      await act(async () => { calls[0].handlers.onDone?.(); });
      expect((calls[1].body as { message: string; images: ImageAttachment[] }).images).toEqual([img]);
    });

    it("clears the queue when starting a new chat", async () => {
      fetchJSONSpy.mockResolvedValue({ ok: true, status: 200, data: baseInit });
      const calls = manualSSEMock();

      const { result } = renderHook(() => useChat(), { wrapper: wrapperWithChat });
      await act(async () => { await result.current.context.init(); });
      await act(async () => { await result.current.sendMessage("first"); });
      act(() => result.current.enqueueMessage("second"));

      await act(async () => { await result.current.startNewChat(); });
      // The new chat's init would re-run; assert the queue didn't leak across
      // sessions by confirming nothing extra was streamed for the old queue.
      expect(queuedEntries(result.current.transcript)).toHaveLength(0);
      expect(calls).toHaveLength(1);
    });
  });
});
