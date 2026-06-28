import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";
import type { ImageAttachment } from "../api/types";

const noopAsync = async () => {};

const baseProps = {
  busy: false,
  steerEnabled: false,
  steerSupported: true,
  imagesSupported: true,
  attachments: [] as ImageAttachment[],
  onRemoveAttachment: vi.fn(),
  onAttachFiles: vi.fn(),
  onSend: vi.fn(),
  onSteer: noopAsync,
  onCancel: noopAsync,
  onQueue: noopAsync,
  onToggleSteer: vi.fn(),
};

describe("<Composer>", () => {
  it("submits with the trimmed text", () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(textarea, { target: { value: "  hi  " } });
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("shows the cancel button while busy", () => {
    render(<Composer {...baseProps} busy={true} />);
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("calls onCancel when stop is clicked", () => {
    const onCancel = vi.fn();
    render(<Composer {...baseProps} busy={true} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Stop"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders image attachments with remove buttons", () => {
    const onRemove = vi.fn();
    const attachments: ImageAttachment[] = [{ data: "abc", mimeType: "image/png", filename: "a.png" }];
    render(<Composer {...baseProps} attachments={attachments} onRemoveAttachment={onRemove} />);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    fireEvent.click(screen.getByText("×"));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
