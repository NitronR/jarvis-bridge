import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "./Pill";

describe("<Pill>", () => {
  it("renders its children", () => {
    render(<Pill>in 120</Pill>);
    expect(screen.getByText("in 120")).toBeInTheDocument();
  });

  it("defaults to the neutral tone", () => {
    render(<Pill>in 120</Pill>);
    expect(screen.getByText("in 120").className).toMatch(/neutral/);
  });

  it("applies the requested tone", () => {
    render(<Pill tone="danger">error</Pill>);
    expect(screen.getByText("error").className).toMatch(/danger/);
  });
});
