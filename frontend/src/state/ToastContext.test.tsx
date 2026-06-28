import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider, useToast } from "./ToastContext";

describe("ToastContext", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("push adds a toast", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.push("hello", "info"));
    act(() => result.current.push("oh no", "error"));
    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.toasts[0].message).toBe("hello");
    expect(result.current.toasts[1].kind).toBe("error");
  });

  it("info toasts auto-dismiss after 4s", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.push("x", "info"));
    expect(result.current.toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(4100));
    expect(result.current.toasts).toHaveLength(0);
  });

  it("error toasts are sticky", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.push("boom", "error"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.toasts).toHaveLength(1);
  });
});
