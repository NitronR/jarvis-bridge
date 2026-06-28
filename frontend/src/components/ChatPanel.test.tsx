import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../state/ToastContext";
import { ChatPanel } from "./ChatPanel";

describe("<ChatPanel>", () => {
  it("renders the title, info toggle, and composer", () => {
    render(
      <ToastProvider>
        <ChatPanel />
      </ToastProvider>,
    );
    expect(screen.getByText("New chat")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("renders the empty transcript state", () => {
    render(
      <ToastProvider>
        <ChatPanel />
      </ToastProvider>,
    );
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });
});
