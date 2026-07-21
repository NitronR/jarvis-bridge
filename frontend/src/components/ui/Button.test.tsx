import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("<Button>", () => {
  it("renders children and responds to clicks", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies the primary variant class", () => {
    render(<Button variant="primary">Send</Button>);
    expect(screen.getByRole("button", { name: "Send" }).className).toMatch(/primary/);
  });

  it("applies the danger variant class", () => {
    render(<Button variant="danger">Stop</Button>);
    expect(screen.getByRole("button", { name: "Stop" }).className).toMatch(/danger/);
  });

  it("applies no variant class for the default variant", () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" }).className).not.toMatch(/primary|danger/);
  });

  it("respects the disabled prop", () => {
    render(<Button disabled>Send</Button>);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
