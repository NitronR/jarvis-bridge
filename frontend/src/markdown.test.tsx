import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./markdown";

describe("<Markdown>", () => {
  it("renders plain text", () => {
    const { container } = render(<Markdown source="hello world" />);
    expect(container.textContent).toBe("hello world");
  });

  it("renders bold and italic", () => {
    const { container } = render(<Markdown source="**bold** and *em*" />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("em");
  });

  it("renders a code block", () => {
    const md = "```\nlet x = 1;\n```";
    const { container } = render(<Markdown source={md} />);
    expect(container.querySelector("pre code")).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toContain("let x = 1;");
  });

  it("strips a <script> tag via rehype-sanitize", () => {
    const md = "before\n\n<script>alert(1)</script>\n\nafter";
    const { container } = render(<Markdown source={md} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });
});
