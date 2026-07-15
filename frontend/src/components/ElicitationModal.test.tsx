import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ElicitationModal } from "./ElicitationModal";

const selectPatch = {
  type: "elicitation-request" as const,
  requestId: "e-1",
  toolCallId: "tc-1",
  message: "Pick one",
  fields: [
    {
      key: "question_0",
      kind: "select" as const,
      options: [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ],
    },
    { key: "question_0_custom", title: "Other", kind: "text" as const },
  ],
};

const multiSelectPatch = {
  type: "elicitation-request" as const,
  requestId: "e-2",
  toolCallId: null,
  message: "Pick any",
  fields: [
    {
      key: "question_0",
      kind: "multi-select" as const,
      options: [
        { value: "x", label: "X" },
        { value: "y", label: "Y" },
      ],
    },
  ],
};

describe("<ElicitationModal>", () => {
  it("renders nothing when not open", () => {
    const { container } = render(<ElicitationModal patch={null} onResolve={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the message and field options", () => {
    render(<ElicitationModal patch={selectPatch} onResolve={vi.fn()} />);
    expect(screen.getByText("Pick one")).toBeInTheDocument();
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
  });

  it("Submit sends the selected option under the field's key", () => {
    const onResolve = vi.fn();
    render(<ElicitationModal patch={selectPatch} onResolve={onResolve} />);
    fireEvent.click(screen.getByText("Option B"));
    fireEvent.click(screen.getByText("Submit"));
    expect(onResolve).toHaveBeenCalledWith("e-1", "accept", { question_0: "b" });
  });

  it("a typed custom-field value is included in the submitted content", () => {
    const onResolve = vi.fn();
    render(<ElicitationModal patch={selectPatch} onResolve={onResolve} />);
    fireEvent.change(screen.getByPlaceholderText("Other"), { target: { value: "my own answer" } });
    fireEvent.click(screen.getByText("Submit"));
    expect(onResolve).toHaveBeenCalledWith("e-1", "accept", { question_0_custom: "my own answer" });
  });

  it("multi-select checkboxes collect multiple values into an array", () => {
    const onResolve = vi.fn();
    render(<ElicitationModal patch={multiSelectPatch} onResolve={onResolve} />);
    fireEvent.click(screen.getByText("X"));
    fireEvent.click(screen.getByText("Y"));
    fireEvent.click(screen.getByText("Submit"));
    expect(onResolve).toHaveBeenCalledWith("e-2", "accept", { question_0: ["x", "y"] });
  });

  it("Skip resolves with decline and no content", () => {
    const onResolve = vi.fn();
    render(<ElicitationModal patch={selectPatch} onResolve={onResolve} />);
    fireEvent.click(screen.getByText("Skip"));
    expect(onResolve).toHaveBeenCalledWith("e-1", "decline");
  });
});
