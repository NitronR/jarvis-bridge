import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Dot } from "./Dot";

describe("<Dot>", () => {
  it("defaults to idle status", () => {
    const { container } = render(<Dot />);
    expect(container.firstElementChild?.className).toMatch(/idle/);
  });

  it("applies the ok class", () => {
    const { container } = render(<Dot status="ok" />);
    expect(container.firstElementChild?.className).toMatch(/ok/);
  });

  it("applies the bad class", () => {
    const { container } = render(<Dot status="bad" />);
    expect(container.firstElementChild?.className).toMatch(/bad/);
  });

  it("applies the progress class", () => {
    const { container } = render(<Dot status="progress" />);
    expect(container.firstElementChild?.className).toMatch(/progress/);
  });

  it("forwards arbitrary props like data-testid", () => {
    const { getByTestId } = render(<Dot status="ok" data-testid="health-dot" />);
    expect(getByTestId("health-dot")).toBeInTheDocument();
  });
});
