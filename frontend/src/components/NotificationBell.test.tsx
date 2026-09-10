import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationBell } from "./NotificationBell";

describe("<NotificationBell>", () => {
  it("shows as on (aria-pressed true) when enabled", () => {
    render(<NotificationBell enabled onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /notifications on/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows as off (aria-pressed false) when disabled", () => {
    render(<NotificationBell enabled={false} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /notifications off/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onToggle on click", () => {
    const onToggle = vi.fn();
    render(<NotificationBell enabled onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});