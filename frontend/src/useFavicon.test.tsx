import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const state = { busy: false, unread: false, awaitingInput: false };

vi.mock("./state/ChatContext", () => ({
  useChatContext: () => ({ state }),
}));

import { useFavicon } from "./useFavicon";

function currentColor(): string {
  const href = document.querySelector<HTMLLinkElement>("link[rel='icon']")!.href;
  return decodeURIComponent(href).match(/fill="([^"]+)"/)![1];
}

describe("useFavicon", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    state.busy = false;
    state.unread = false;
    state.awaitingInput = false;
  });

  it("uses idle blue by default", () => {
    renderHook(() => useFavicon());
    expect(currentColor()).toBe("#3B82F6");
  });

  it("uses green when unread", () => {
    state.unread = true;
    renderHook(() => useFavicon());
    expect(currentColor()).toBe("#22C55E");
  });

  it("uses orange when busy", () => {
    state.busy = true;
    renderHook(() => useFavicon());
    expect(currentColor()).toBe("#F97316");
  });

  it("uses yellow when a question/input dialog is open", () => {
    state.awaitingInput = true;
    renderHook(() => useFavicon());
    expect(currentColor()).toBe("#EAB308");
  });

  it("prefers awaiting-input over busy", () => {
    state.busy = true;
    state.awaitingInput = true;
    renderHook(() => useFavicon());
    expect(currentColor()).toBe("#EAB308");
  });
});
