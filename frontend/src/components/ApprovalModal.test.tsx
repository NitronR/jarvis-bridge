import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalModal } from "./ApprovalModal";

const basePatch = {
  type: "approval-request" as const,
  requestId: "r-1",
  toolCallId: "tc-1",
  toolName: "bash",
  options: [
    { id: "allow_once", name: "Allow once" },
    { id: "allow_always", name: "Always" },
  ],
};

describe("<ApprovalModal>", () => {
  it("renders nothing when not open", () => {
    const { container } = render(<ApprovalModal patch={null} onResolve={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the tool name and options", () => {
    render(<ApprovalModal patch={basePatch} onResolve={vi.fn()} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.getByText("Always")).toBeInTheDocument();
  });

  it("calls onResolve with the chosen optionId", () => {
    const onResolve = vi.fn();
    render(<ApprovalModal patch={basePatch} onResolve={onResolve} />);
    fireEvent.click(screen.getByText("Allow once"));
    expect(onResolve).toHaveBeenCalledWith("r-1", "allow_once");
  });

  it("offers a Deny button when no reject option is present", () => {
    render(<ApprovalModal patch={basePatch} onResolve={vi.fn()} />);
    expect(screen.getByText("Deny")).toBeInTheDocument();
  });
});
