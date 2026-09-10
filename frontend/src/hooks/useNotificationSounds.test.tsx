import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const state = { busy: false, awaitingInput: false };

vi.mock("../state/ChatContext", () => ({
  useChatContext: () => ({ state }),
}));

vi.mock("../state/notifications", () => ({
  playSound: vi.fn(),
}));

import { playSound } from "../state/notifications";
import { useNotificationSounds } from "./useNotificationSounds";

describe("useNotificationSounds", () => {
  beforeEach(() => {
    state.busy = false;
    state.awaitingInput = false;
    vi.mocked(playSound).mockClear();
  });

  it("plays response-complete when busy falls true->false", () => {
    const { rerender } = renderHook(() => useNotificationSounds(true));
    state.busy = true;
    rerender();
    expect(vi.mocked(playSound)).not.toHaveBeenCalled();
    state.busy = false;
    rerender();
    expect(vi.mocked(playSound)).toHaveBeenCalledWith("response-complete");
  });

  it("plays input-needed when awaitingInput rises false->true", () => {
    const { rerender } = renderHook(() => useNotificationSounds(true));
    state.awaitingInput = true;
    rerender();
    expect(vi.mocked(playSound)).toHaveBeenCalledWith("input-needed");
  });

  it("does not play on steady state", () => {
    const { rerender } = renderHook(() => useNotificationSounds(true));
    rerender();
    rerender();
    expect(vi.mocked(playSound)).not.toHaveBeenCalled();
  });

  it("does not play when enabled is false, but still tracks edges", () => {
    const { rerender } = renderHook(() => useNotificationSounds(false));
    state.busy = true;
    rerender();
    state.busy = false;
    rerender();
    expect(vi.mocked(playSound)).not.toHaveBeenCalled();
  });
});