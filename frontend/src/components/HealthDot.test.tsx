import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { HealthDot } from "./HealthDot";
import * as client from "../api/client";

describe("<HealthDot>", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("calls onUpdate(true) when /health/agent returns agent:true", async () => {
    vi.spyOn(client, "fetchJSON").mockResolvedValue({ ok: true, status: 200, data: { agent: true } });
    const onUpdate = vi.fn();
    render(<HealthDot onUpdate={onUpdate} />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(onUpdate).toHaveBeenCalledWith(true);
  });

  it("calls onUpdate(false) when agent is unreachable", async () => {
    vi.spyOn(client, "fetchJSON").mockResolvedValue({ ok: false, status: 500, data: null });
    const onUpdate = vi.fn();
    render(<HealthDot onUpdate={onUpdate} />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(onUpdate).toHaveBeenCalledWith(false);
  });
});
