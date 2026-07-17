import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoPanel } from "./InfoPanel";
import type { ChatState } from "../state/ChatContext";

const baseState: ChatState = {
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  backendName: "fake",
  loading: false,
  activeTurn: false,
  capabilities: {
    multipleSessions: true, customWorkingDirectory: true, cancel: true, steer: true,
    toolApprovals: true, slashCommands: true, canFork: true, images: true,
    sessionDelete: false, promptQueueing: false, usageQuery: false,
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
  lastUsage: null,
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

  it("does not render a Usage card when no usage is passed", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.queryByText("Usage")).not.toBeInTheDocument();
  });

  it("renders rate-limit windows and cost under a Usage card", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          cost: { amount: 0.42, currency: "USD" },
          rate_limits: {
            // resetsAt is epoch ms (already normalized by the backend from
            // the SDK's epoch-seconds wire value) — this exercises that the
            // component renders it on its own line rather than crammed next
            // to the percentage, which used to wrap awkwardly in the narrow
            // sidebar.
            five_hour: { status: "allowed", utilization: 0.12, resetsAt: Date.UTC(2026, 6, 16, 2, 5) },
            seven_day: { status: "allowed_warning", utilization: 0.86 },
          },
        }}
      />,
    );
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("Session (5h)")).toBeInTheDocument();
    expect(screen.getByText(/12%/)).toBeInTheDocument();
    expect(screen.getByText(/resets/)).toBeInTheDocument();
    expect(screen.getByText("Week")).toBeInTheDocument();
    expect(screen.getByText(/86%/)).toBeInTheDocument();
    expect(screen.getByText("$0.42")).toBeInTheDocument();
  });

  it("falls back to status text when a rate-limit window has no utilization", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { overage: { status: "rejected" } },
        }}
      />,
    );
    expect(screen.getByText("Overage")).toBeInTheDocument();
    expect(screen.getByText("rejected")).toBeInTheDocument();
  });

  it("does not render a Usage card or refresh button when usageQuerySupported is false and there's no usage data", () => {
    render(<InfoPanel {...baseProps} usageQuerySupported={false} />);
    expect(screen.queryByText("Usage")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Refresh usage")).not.toBeInTheDocument();
  });

  it("renders a refresh button and a placeholder row when usageQuerySupported is true but no usage data yet", () => {
    render(<InfoPanel {...baseProps} usageQuerySupported />);
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByLabelText("Refresh usage")).toBeInTheDocument();
    expect(screen.getByText("tap refresh")).toBeInTheDocument();
  });

  it("calls onRefreshUsage when the refresh button is clicked, and disables it while refreshing", () => {
    const onRefreshUsage = vi.fn();
    const { rerender } = render(
      <InfoPanel {...baseProps} usageQuerySupported onRefreshUsage={onRefreshUsage} />,
    );
    fireEvent.click(screen.getByLabelText("Refresh usage"));
    expect(onRefreshUsage).toHaveBeenCalledTimes(1);

    rerender(<InfoPanel {...baseProps} usageQuerySupported refreshingUsage onRefreshUsage={onRefreshUsage} />);
    expect(screen.getByLabelText("Refresh usage")).toBeDisabled();
  });

  it("prefers numeric resetsAt but falls back to resetsAtText when only the manual-refresh text is present", () => {
    render(
      <InfoPanel
        {...baseProps}
        usageQuerySupported
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { five_hour: { status: "allowed", utilization: 0.33, resetsAtText: "Jul 16 at 9am (UTC)" } },
        }}
      />,
    );
    expect(screen.getByText(/Jul 16 at 9am \(UTC\)/)).toBeInTheDocument();
  });
});
