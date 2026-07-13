import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PastChatsMenu } from "./PastChatsMenu";

describe("<PastChatsMenu>", () => {
  it("renders empty state when no sessions", () => {
    render(<PastChatsMenu open={true} sessions={[]} onClose={vi.fn()} onSwitch={vi.fn()} />);
    expect(screen.getByText(/no past chats/i)).toBeInTheDocument();
  });

  it("renders each session and calls onSwitch when clicked", () => {
    const onSwitch = vi.fn();
    render(
      <PastChatsMenu
        open={true}
        sessions={[
          { sessionId: "s1", title: "first", customTitle: "alpha" },
          { sessionId: "s2", title: "second" },
        ]}
        onClose={vi.fn()}
        onSwitch={onSwitch}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    fireEvent.click(screen.getByText("second"));
    expect(onSwitch).toHaveBeenCalledWith("s2");
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PastChatsMenu open={false} sessions={[]} onClose={vi.fn()} onSwitch={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a Delete button per session when canDelete is true", () => {
    const onDelete = vi.fn();
    render(
      <PastChatsMenu
        open={true}
        sessions={[{ sessionId: "s1", title: "Test" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
        onDelete={onDelete}
        canDelete={true}
      />,
    );
    const btn = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("omits the Delete button when canDelete is false", () => {
    render(
      <PastChatsMenu
        open={true}
        sessions={[{ sessionId: "s1", title: "Test" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
        canDelete={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
