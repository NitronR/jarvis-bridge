import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript } from "./Transcript";

describe("<Transcript>", () => {
  it("renders the empty state when no messages", () => {
    render(<Transcript entries={[]} onApproval={vi.fn()} onSteerAck={vi.fn()} onImagesSkipped={vi.fn()} />);
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });

  it("renders one Message per entry", () => {
    render(
      <Transcript
        entries={[
          { role: "user", text: "hi" },
          { role: "assistant", patches: [{ type: "text-start", index: 0, content: "hello" }] },
        ]}
        onApproval={vi.fn()}
        onSteerAck={vi.fn()}
        onImagesSkipped={vi.fn()}
      />,
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
