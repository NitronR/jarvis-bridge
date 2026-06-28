import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE } from "./useSSE";
import * as client from "../api/client";

function mockSSE(lines: string[]) {
  vi.spyOn(client, "fetchSSE").mockImplementation((_url, _body, handlers) => {
    let i = 0;
    const interval = setInterval(() => {
      if (i >= lines.length) {
        clearInterval(interval);
        handlers.onDone?.();
        return;
      }
      try {
        const patch = JSON.parse(lines[i]);
        handlers.onPatch(patch);
      } catch {
        handlers.onError?.(new Error("bad json"));
      }
      i++;
    }, 5);
    return { abort: () => clearInterval(interval), done: Promise.resolve() };
  });
}

describe("useSSE", () => {
  it("collects patches from the stream", async () => {
    mockSSE([
      JSON.stringify({ type: "text-start", index: 0, content: "hi" }),
      JSON.stringify({ type: "text-delta", index: 0, delta: " there" }),
      JSON.stringify({ type: "done" }),
    ]);
    const onPatch = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() =>
      useSSE({ url: "/x", body: {}, enabled: true, onPatch, onDone }),
    );
    act(() => result.current.start());
    await new Promise((r) => setTimeout(r, 40));
    expect(onPatch).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("abort stops the stream", async () => {
    mockSSE([JSON.stringify({ type: "text-delta", index: 0, delta: "x" })]);
    const onPatch = vi.fn();
    const { result } = renderHook(() =>
      useSSE({ url: "/x", body: {}, enabled: true, onPatch }),
    );
    act(() => result.current.start());
    act(() => result.current.abort());
    await new Promise((r) => setTimeout(r, 20));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("busy is true while streaming", () => {
    mockSSE([]);
    const { result } = renderHook(() =>
      useSSE({ url: "/x", body: {}, enabled: true, onPatch: vi.fn() }),
    );
    act(() => result.current.start());
    expect(result.current.busy).toBe(true);
  });
});
