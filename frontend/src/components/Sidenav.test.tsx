import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidenav } from "./Sidenav";

const noop = () => {};
describe("<Sidenav>", () => {
  it("renders the brand and tabs", () => {
    render(<Sidenav current="chat" onNavigate={noop} healthOk={null} collapsed={false} onToggleCollapsed={noop} />);
    expect(screen.getByText("Jarvis Bridge")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("marks the active tab", () => {
    render(<Sidenav current="status" onNavigate={noop} healthOk={null} collapsed={false} onToggleCollapsed={noop} />);
    const statusBtn = screen.getByText("Status").closest("button");
    expect(statusBtn?.className).toMatch(/active/);
  });

  it("calls onNavigate when a tab is clicked", () => {
    const onNav = vi.fn();
    render(<Sidenav current="chat" onNavigate={onNav} healthOk={null} collapsed={false} onToggleCollapsed={noop} />);
    fireEvent.click(screen.getByText("Status"));
    expect(onNav).toHaveBeenCalledWith("status");
  });

  it("shows ok health dot", () => {
    const { container } = render(<Sidenav current="chat" onNavigate={noop} healthOk={true} collapsed={false} onToggleCollapsed={noop} />);
    const dot = container.querySelector('[data-testid="health-dot"]');
    expect(dot?.className).toMatch(/ok/);
  });

  it("shows bad health dot", () => {
    const { container } = render(<Sidenav current="chat" onNavigate={noop} healthOk={false} collapsed={false} onToggleCollapsed={noop} />);
    const dot = container.querySelector('[data-testid="health-dot"]');
    expect(dot?.className).toMatch(/bad/);
  });

  it("marks nav content aria-hidden when collapsed, keeping the toggle interactive", () => {
    render(<Sidenav current="chat" onNavigate={noop} healthOk={null} collapsed={true} onToggleCollapsed={noop} />);
    // Content stays mounted (so the width/opacity transition can animate) but is hidden from a11y tree.
    const navBody = screen.getByText("Jarvis Bridge").closest('[aria-hidden]');
    expect(navBody).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: /expand navigation/i })).toBeInTheDocument();
  });

  it("calls onToggleCollapsed when the collapse/expand button is clicked", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Sidenav current="chat" onNavigate={noop} healthOk={null} collapsed={false} onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /collapse navigation/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<Sidenav current="chat" onNavigate={noop} healthOk={null} collapsed={true} onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /expand navigation/i }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
