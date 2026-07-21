import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("<Avatar>", () => {
  it("renders the Y initial and You aria-label for the user role", () => {
    const { getByLabelText } = render(<Avatar role="user" />);
    expect(getByLabelText("You").textContent).toBe("Y");
  });

  it("renders the AI initial and Assistant aria-label for the assistant role", () => {
    const { getByLabelText } = render(<Avatar role="assistant" />);
    expect(getByLabelText("Assistant").textContent).toBe("AI");
  });

  it("applies the role-specific class", () => {
    const { container } = render(<Avatar role="assistant" />);
    expect(container.firstElementChild?.className).toMatch(/assistant/);
  });

  it("forwards arbitrary props like data-testid", () => {
    const { getByTestId } = render(<Avatar role="user" data-testid="msg-avatar" />);
    expect(getByTestId("msg-avatar")).toBeInTheDocument();
  });
});
