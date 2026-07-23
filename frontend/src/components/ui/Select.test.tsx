import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "./Select";

const options = [
  { value: "m1", label: "Model One" },
  { value: "m2", label: "Model Two" },
  { value: "m3", label: "Model Three" },
];

describe("<Select>", () => {
  it("renders the trigger with the selected option's label", () => {
    render(<Select value="m2" options={options} onChange={vi.fn()} aria-label="Model" />);
    expect(screen.getByTestId("select-model")).toHaveTextContent("Model Two");
  });

  it("shows a dash when no value matches", () => {
    render(<Select value="" options={options} onChange={vi.fn()} aria-label="Model" />);
    expect(screen.getByTestId("select-model")).toHaveTextContent("—");
  });

  it("opens the dropdown on click and shows all options", () => {
    render(<Select value="m1" options={options} onChange={vi.fn()} aria-label="Model" />);
    fireEvent.click(screen.getByTestId("select-model"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "Model One" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Model Two" })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange and closes when an option is clicked", () => {
    const onChange = vi.fn();
    render(<Select value="m1" options={options} onChange={onChange} aria-label="Model" />);
    fireEvent.click(screen.getByTestId("select-model"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Model Three" }));
    expect(onChange).toHaveBeenCalledWith("m3");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to trigger", () => {
    render(<Select value="m1" options={options} onChange={vi.fn()} aria-label="Model" />);
    const trigger = screen.getByTestId("select-model");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("navigates with arrow keys and selects with Enter", () => {
    const onChange = vi.fn();
    render(<Select value="m1" options={options} onChange={onChange} aria-label="Model" />);
    fireEvent.click(screen.getByTestId("select-model"));
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    // First ArrowDown opens the dropdown and sets focus to 0 (m1, already selected).
    // Second ArrowDown moves focus to index 1 (m2).
    // Enter selects the focused option.
    expect(onChange).toHaveBeenCalledWith("m2");
  });

  it("disables the trigger when disabled is true", () => {
    render(<Select value="m1" options={options} onChange={vi.fn()} disabled aria-label="Model" />);
    expect(screen.getByTestId("select-model")).toBeDisabled();
  });

  it("does not open the dropdown when disabled", () => {
    render(<Select value="m1" options={options} onChange={vi.fn()} disabled aria-label="Model" />);
    fireEvent.click(screen.getByTestId("select-model"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on click-outside", () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <Select value="m1" options={options} onChange={vi.fn()} aria-label="Model" />
      </div>,
    );
    fireEvent.click(screen.getByTestId("select-model"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
