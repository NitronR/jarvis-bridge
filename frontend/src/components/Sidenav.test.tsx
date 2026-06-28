import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidenav } from "./Sidenav";

const noop = () => {};
describe("<Sidenav>", () => {
  it("renders the brand and tabs", () => {
    render(<Sidenav current="chat" onNavigate={noop} healthOk={null} />);
    expect(screen.getByText("Jarvis Bridge")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("marks the active tab", () => {
    render(<Sidenav current="status" onNavigate={noop} healthOk={null} />);
    const statusBtn = screen.getByText("Status").closest("button");
    expect(statusBtn?.className).toMatch(/active/);
  });

  it("calls onNavigate when a tab is clicked", () => {
    const onNav = vi.fn();
    render(<Sidenav current="chat" onNavigate={onNav} healthOk={null} />);
    fireEvent.click(screen.getByText("Status"));
    expect(onNav).toHaveBeenCalledWith("status");
  });

  it("shows ok health dot", () => {
    const { container } = render(<Sidenav current="chat" onNavigate={noop} healthOk={true} />);
    const dot = container.querySelector('[data-testid="health-dot"]');
    expect(dot?.className).toMatch(/ok/);
  });

  it("shows bad health dot", () => {
    const { container } = render(<Sidenav current="chat" onNavigate={noop} healthOk={false} />);
    const dot = container.querySelector('[data-testid="health-dot"]');
    expect(dot?.className).toMatch(/bad/);
  });
});
