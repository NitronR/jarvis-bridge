import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoPanel } from "./InfoPanel";
import type { ChatState } from "../state/ChatContext";

const baseState: ChatState = {
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  capabilities: {
    multipleSessions: true, customWorkingDirectory: true, cancel: true, steer: true,
    toolApprovals: true, slashCommands: true, canFork: true, images: true,
  },
  slashCommands: [{ name: "review" }],
  models: [{ modelId: "m1", name: "Model One" }],
  currentModel: "m1",
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  busy: false,
  title: "My chat",
  resumed: false,
};

const baseProps = {
  state: baseState, title: "My chat", group: "", pinned: false,
  onRename: vi.fn(), onGroup: vi.fn(), onPinned: vi.fn(),
  onModelChange: vi.fn(), onAutoApproveToggle: vi.fn(),
};

describe("<InfoPanel>", () => {
  it("renders session id, cwd, slash count, model", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ws")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Model One")).toBeInTheDocument();
  });

  it("calls onRename when title input changes", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} title="" onRename={onRename} />);
    fireEvent.change(screen.getByPlaceholderText("Untitled"), { target: { value: "new title" } });
    expect(onRename).toHaveBeenCalledWith("new title");
  });

  it("calls onAutoApproveToggle when the toggle is clicked", () => {
    const onToggle = vi.fn();
    render(<InfoPanel {...baseProps} onAutoApproveToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("auto-approve-toggle"));
    expect(onToggle).toHaveBeenCalled();
  });
});
