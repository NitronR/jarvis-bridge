import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHashRoute, parseHash } from "./useHashRoute";

describe("parseHash", () => {
  it("defaults to chat on empty hash", () => {
    expect(parseHash("")).toBe("chat");
    expect(parseHash("#")).toBe("chat");
  });
  it("parses simple routes", () => {
    expect(parseHash("#status")).toBe("status");
    expect(parseHash("#chat")).toBe("chat");
    expect(parseHash("#skills-manage")).toBe("skills-manage");
  });
  it("parses skill/<name>", () => {
    expect(parseHash("#skill/chatgpt")).toBe("skill/chatgpt");
  });
  it("falls back to chat on unknown", () => {
    expect(parseHash("#bogus")).toBe("chat");
  });
});

describe("useHashRoute", () => {
  beforeEach(() => { window.location.hash = ""; });
  afterEach(() => { window.location.hash = ""; });

  it("returns initial route from current hash", () => {
    window.location.hash = "#status";
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe("status");
  });

  it("navigate updates hash and state", () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => result.current.navigate("status"));
    expect(result.current.route).toBe("status");
  });

  it("reacts to hashchange event", () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => {
      window.location.hash = "#status";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.route).toBe("status");
  });
});