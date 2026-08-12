import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Transcript } from "./Transcript";

describe("<Transcript>", () => {
  it("renders the empty state when no messages", () => {
    render(<Transcript entries={[]} onApproval={vi.fn()} onElicitation={vi.fn()} onImagesSkipped={vi.fn()} />);
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
        onElicitation={vi.fn()}
        onImagesSkipped={vi.fn()}
      />,
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("shows the avatar only on the first message of a consecutive same-role run", () => {
    render(
      <Transcript
        entries={[
          { role: "assistant", patches: [{ type: "text-start", index: 0, content: "first" }] },
          { role: "assistant", patches: [{ type: "text-start", index: 0, content: "second" }] },
        ]}
        onApproval={vi.fn()}
        onElicitation={vi.fn()}
        onImagesSkipped={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText("Assistant")).toHaveLength(1);
  });

  it("shows an avatar on each message when roles alternate", () => {
    render(
      <Transcript
        entries={[
          { role: "user", text: "hi" },
          { role: "assistant", patches: [{ type: "text-start", index: 0, content: "hello" }] },
        ]}
        onApproval={vi.fn()}
        onElicitation={vi.fn()}
        onImagesSkipped={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText("You")).toHaveLength(1);
    expect(screen.getAllByLabelText("Assistant")).toHaveLength(1);
  });

  describe("scroll-on-load", () => {
    const longEntries = [
      { role: "user", text: "q1" },
      { role: "assistant", patches: [{ type: "text-start", index: 0, content: "a1" }] },
      { role: "user", text: "q2" },
      { role: "assistant", patches: [{ type: "text-start", index: 0, content: "a2" }] },
    ];
    const base = {
      onApproval: vi.fn(),
      onElicitation: vi.fn(),
      onImagesSkipped: vi.fn(),
    };

    // Simulate a viewport where the populated transcript scrolls (jsdom
    // reports 0 for both metrics, so without this every scroll-position check
    // reads "at bottom" and the bug can't reproduce). The loading/empty
    // placeholder is short (60px); the populated log overflows (1000px).
    beforeAll(() => {
      Object.defineProperty(Element.prototype, "scrollHeight", {
        configurable: true,
        get(this: Element) { return this.getAttribute("role") === "log" ? 1000 : 60; },
      });
      Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get: () => 600 });
    });
    afterAll(() => {
      delete (Element.prototype as unknown as { scrollHeight?: unknown }).scrollHeight;
      delete (Element.prototype as unknown as { clientHeight?: unknown }).clientHeight;
    });

    it("opens a freshly loaded chat at the bottom even when the previous chat left the scroll state 'not at bottom'", () => {
      const { rerender } = render(<Transcript entries={longEntries} {...base} />);
      // The user had scrolled up in the previous chat, so the scroll listener
      // marked us "not at bottom".
      const log = screen.getByRole("log") as HTMLDivElement;
      log.scrollTop = 0;
      fireEvent.scroll(log);

      // Switch sessions: transcript empties, then the new chat's history lands.
      rerender(<Transcript entries={[]} {...base} />);
      rerender(<Transcript entries={longEntries} {...base} />);

      const logAfter = screen.getByRole("log") as HTMLDivElement;
      expect(logAfter.scrollTop).toBe(1000);
    });

    it("settles at the bottom when loading completes after the transcript already populated", () => {
      const { rerender } = render(<Transcript entries={longEntries} loading={true} {...base} />);
      // init awaits a separate /chat/groups fetch, so history can land while
      // the loading placeholder is still shown. Real content mounts only once
      // loading flips false — the bottom-scroll must survive that transition.
      rerender(<Transcript entries={longEntries} loading={false} {...base} />);

      const log = screen.getByRole("log") as HTMLDivElement;
      expect(log.scrollTop).toBe(1000);
    });

    it("does not yank back to the bottom on live updates after the user scrolled up", () => {
      const { rerender } = render(<Transcript entries={longEntries} {...base} />);
      const log = screen.getByRole("log") as HTMLDivElement;
      log.scrollTop = 0;
      fireEvent.scroll(log);

      rerender(
        <Transcript
          entries={[
            ...longEntries,
            { role: "user", text: "q3" },
            { role: "assistant", patches: [{ type: "text-start", index: 0, content: "a3" }] },
          ]}
          {...base}
        />,
      );

      const logAfter = screen.getByRole("log") as HTMLDivElement;
      expect(logAfter.scrollTop).toBe(0);
    });

    it("keeps following when at the bottom as new entries stream in", () => {
      const { rerender } = render(<Transcript entries={longEntries} {...base} />);
      const log = screen.getByRole("log") as HTMLDivElement;
      expect(log.scrollTop).toBe(1000);

      rerender(
        <Transcript
          entries={[
            ...longEntries,
            { role: "user", text: "q3" },
            { role: "assistant", patches: [{ type: "text-start", index: 0, content: "a3" }] },
          ]}
          {...base}
        />,
      );

      const logAfter = screen.getByRole("log") as HTMLDivElement;
      expect(logAfter.scrollTop).toBe(1000);
    });
  });
});
