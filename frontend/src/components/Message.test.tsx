import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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
});
