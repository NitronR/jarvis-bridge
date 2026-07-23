import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickPhrasesRow } from "./QuickPhrasesRow";

describe("<QuickPhrasesRow>", () => {
  it("renders only the add button when there are no phrases", () => {
    render(<QuickPhrasesRow phrases={[]} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add quick phrase" })).toBeInTheDocument();
  });

  it("renders a pill per phrase", () => {
    render(<QuickPhrasesRow phrases={["run the tests", "ping me"]} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "run the tests" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ping me" })).toBeInTheDocument();
  });

  it("calls onSubmit with the phrase text when a pill is clicked", () => {
    const onSubmit = vi.fn();
    render(<QuickPhrasesRow phrases={["run the tests"]} onSubmit={onSubmit} onAdd={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "run the tests" }));
    expect(onSubmit).toHaveBeenCalledWith("run the tests");
  });

  it("calls onDelete with the phrase's index when its delete cross is clicked, without submitting", () => {
    const onSubmit = vi.fn();
    const onDelete = vi.fn();
    render(<QuickPhrasesRow phrases={["a", "b"]} onSubmit={onSubmit} onAdd={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove quick phrase: b" }));
    expect(onDelete).toHaveBeenCalledWith(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("opens an inline input when the add button is clicked", () => {
    render(<QuickPhrasesRow phrases={[]} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add quick phrase" }));
    expect(screen.getByPlaceholderText(/new quick phrase/i)).toBeInTheDocument();
  });

  it("calls onAdd with the trimmed text and clears the input on Enter", () => {
    const onAdd = vi.fn();
    render(<QuickPhrasesRow phrases={[]} onSubmit={vi.fn()} onAdd={onAdd} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add quick phrase" }));
    const input = screen.getByPlaceholderText(/new quick phrase/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  ping me when done  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("ping me when done");
    expect(input.value).toBe("");
  });

  it("does not call onAdd and closes the input on Escape", () => {
    const onAdd = vi.fn();
    render(<QuickPhrasesRow phrases={[]} onSubmit={vi.fn()} onAdd={onAdd} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add quick phrase" }));
    const input = screen.getByPlaceholderText(/new quick phrase/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abandoned draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/new quick phrase/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add quick phrase" })).toBeInTheDocument();
  });

  it("does not call onAdd for a blank submission", () => {
    const onAdd = vi.fn();
    render(<QuickPhrasesRow phrases={[]} onSubmit={vi.fn()} onAdd={onAdd} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add quick phrase" }));
    const input = screen.getByPlaceholderText(/new quick phrase/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/new quick phrase/i)).not.toBeInTheDocument();
  });

  it("has a group role and label on the container", () => {
    render(<QuickPhrasesRow phrases={["a"]} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Quick phrases" })).toBeInTheDocument();
  });

  describe("overflow popup", () => {
    // In jsdom all measured widths are 0, so with 3 phrases only the first
    // is "visible" and the rest ("b", "c") land in the overflow popup — see
    // the recompute() trace above.
    const phrases = ["a", "b", "c"];

    it("renders a real, focusable button (not a hover-only div) with aria-haspopup/aria-expanded", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: "2 more quick phrases" });
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle).toHaveAttribute("aria-haspopup", "true");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      toggle.focus();
      expect(toggle).toHaveFocus();
    });

    it("opens the popup on click and shows the hidden phrases", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      expect(screen.getByRole("button", { name: "2 more quick phrases" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "c" })).toBeInTheDocument();
    });

    it("submits a hidden phrase from the popup and closes it", () => {
      const onSubmit = vi.fn();
      render(<QuickPhrasesRow phrases={phrases} onSubmit={onSubmit} onAdd={vi.fn()} onDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      fireEvent.click(screen.getByRole("button", { name: "b" }));
      expect(onSubmit).toHaveBeenCalledWith("b");
      expect(screen.queryByRole("button", { name: "c" })).not.toBeInTheDocument();
    });

    it("deletes a hidden phrase from the popup without submitting it", () => {
      const onSubmit = vi.fn();
      const onDelete = vi.fn();
      render(<QuickPhrasesRow phrases={phrases} onSubmit={onSubmit} onAdd={vi.fn()} onDelete={onDelete} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove quick phrase: c" }));
      expect(onDelete).toHaveBeenCalledWith(2);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("closes on Escape", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("button", { name: "b" })).not.toBeInTheDocument();
    });

    it("returns focus to the toggle button after closing via Escape", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: "2 more quick phrases" });
      fireEvent.click(toggle);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(toggle).toHaveFocus();
    });

    it("closes on click-outside", () => {
      render(<QuickPhrasesRow phrases={phrases} onSubmit={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "2 more quick phrases" }));
      expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("button", { name: "b" })).not.toBeInTheDocument();
    });
  });
});
