import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Message } from "./Message";

describe("<Message>", () => {
  it("renders user text + images", () => {
    const { container } = render(
      <Message entry={{ role: "user", text: "hi", images: [{ data: "abc", mimeType: "image/png", filename: "a.png" }] }} />,
    );
    expect(container.textContent).toContain("hi");
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("renders an assistant timeline from patches", () => {
    const { container } = render(
      <Message entry={{ role: "assistant", patches: [{ type: "text-start", index: 0, content: "ok" }] }} />,
    );
    expect(container.textContent).toContain("ok");
  });

  it("applies the error class when an error patch is present", () => {
    const { container } = render(
      <Message
        entry={{
          role: "assistant",
          patches: [
            { type: "text-start", index: 0, content: "" },
            { type: "error", message: "boom" },
          ],
        }}
      />,
    );
    expect(container.firstElementChild?.className).toMatch(/error/);
  });

  it("shows the avatar by default", () => {
    const { getByLabelText } = render(<Message entry={{ role: "user", text: "hi" }} />);
    expect(getByLabelText("You")).toBeInTheDocument();
  });

  it("hides the avatar when showAvatar is false", () => {
    const { queryByLabelText } = render(
      <Message entry={{ role: "user", text: "hi" }} showAvatar={false} />,
    );
    expect(queryByLabelText("You")).not.toBeInTheDocument();
  });

  it("renders a Queued pill and a dismiss button on a queued message", () => {
    const onDismissQueued = vi.fn();
    const { getByText, getByRole } = render(
      <Message
        entry={{ role: "user", text: "later", queued: true, queueId: "q1" }}
        onDismissQueued={onDismissQueued}
      />,
    );
    expect(getByText("Queued")).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "Remove queued message" }));
    expect(onDismissQueued).toHaveBeenCalledWith("q1");
  });

  it("does not render the Queued pill for a normal (non-queued) user message", () => {
    const { queryByText } = render(<Message entry={{ role: "user", text: "hi" }} />);
    expect(queryByText("Queued")).not.toBeInTheDocument();
  });
});
