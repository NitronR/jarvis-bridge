import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoPanel } from "./InfoPanel";
import type { ChatState } from "../state/ChatContext";

const baseState: ChatState = {
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  backendName: "fake",
  loading: false,
  capabilities: {
    multipleSessions: true, customWorkingDirectory: true, cancel: true, steer: true,
    toolApprovals: true, slashCommands: true, canFork: true, images: true,
    sessionDelete: false, promptQueueing: false,
  },
  slashCommands: [{ name: "review" }],
  models: [{ modelId: "m1", name: "Model One" }],
  currentModel: "m1",
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  busy: false,
  unread: false,
  pinned: false,
  group: "",
  title: "My chat",
  resumed: false,
  history: [],
  turnCounts: {},
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

  it("does not call onRename while typing, only on save", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} title="" onRename={onRename} />);
    fireEvent.change(screen.getByPlaceholderText("Untitled"), { target: { value: "new title" } });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Save title"));
    expect(onRename).toHaveBeenCalledWith("new title");
  });

  it("calls onRename when Enter is pressed in the title input", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} title="" onRename={onRename} />);
    fireEvent.change(screen.getByPlaceholderText("Untitled"), { target: { value: "new title" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Untitled"), { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("new title");
  });

  it("disables the save button until the title is edited", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByLabelText("Save title")).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("My chat"), { target: { value: "My chat 2" } });
    expect(screen.getByLabelText("Save title")).toBeEnabled();
  });

  it("resets the draft title when the title prop changes externally", () => {
    const { rerender } = render(<InfoPanel {...baseProps} />);
    fireEvent.change(screen.getByDisplayValue("My chat"), { target: { value: "unsaved edit" } });
    rerender(<InfoPanel {...baseProps} title="Renamed elsewhere" />);
    expect(screen.getByDisplayValue("Renamed elsewhere")).toBeInTheDocument();
  });

  it("calls onAutoApproveToggle when the toggle is clicked", () => {
    const onToggle = vi.fn();
    render(<InfoPanel {...baseProps} onAutoApproveToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("auto-approve-toggle"));
    expect(onToggle).toHaveBeenCalled();
  });
});
