import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoPanel } from "./InfoPanel";
import type { ChatState } from "../state/ChatContext";

const baseState: ChatState = {
  sessionId: "sess-1",
  cwd: "/tmp/ws",
  backendName: "fake",
  backendKind: "opencode",
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
  groups: [],
  title: "My chat",
  resumed: false,
  history: [],
  turnCounts: {},
  lastUsage: null,
};

const baseProps = {
  state: baseState, title: "My chat", group: "", groups: [], pinned: false,
  onRename: vi.fn(), onGroup: vi.fn(), onAddGroup: vi.fn(), onPinned: vi.fn(),
};

describe("<InfoPanel>", () => {
  it("renders session id, cwd, and slash count", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ws")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByLabelText(/model/i)).not.toBeInTheDocument();
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

  it("does not render an auto-approve toggle", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.queryByTestId("auto-approve-toggle")).not.toBeInTheDocument();
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

  it("renders a group dropdown instead of a text input", () => {
    render(<InfoPanel {...baseProps} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
  });

  it("populates the dropdown with provided groups", () => {
    render(<InfoPanel {...baseProps} groups={["bugfix", "feature"]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("bugfix");
    expect(options).toContain("feature");
  });

  it("includes a None option and Add Group option", () => {
    render(<InfoPanel {...baseProps} groups={["bugfix"]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContainEqual("None");
    expect(options).toContainEqual("+ Add Group…");
  });

  it("selects the current group value", () => {
    render(<InfoPanel {...baseProps} group="bugfix" groups={["bugfix", "feature"]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    expect(select.value).toBe("bugfix");
  });

  it("calls onGroup when a group is selected", () => {
    const onGroup = vi.fn();
    render(<InfoPanel {...baseProps} groups={["bugfix"]} onGroup={onGroup} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "bugfix" } });
    expect(onGroup).toHaveBeenCalledWith("bugfix");
  });

  it("calls onGroup with empty string when None is selected", () => {
    const onGroup = vi.fn();
    render(<InfoPanel {...baseProps} group="bugfix" groups={["bugfix"]} onGroup={onGroup} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    expect(onGroup).toHaveBeenCalledWith("");
  });

  it("opens add-group dialog when Add Group is selected", () => {
    render(<InfoPanel {...baseProps} groups={["bugfix"]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__add_group__" } });
    expect(screen.getByText("Add Group")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/group name/i)).toBeInTheDocument();
  });

  it("calls onAddGroup and onGroup when a new group is created", async () => {
    const onAddGroup = vi.fn().mockResolvedValue(undefined);
    const onGroup = vi.fn();
    render(<InfoPanel {...baseProps} groups={[]} onAddGroup={onAddGroup} onGroup={onGroup} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__add_group__" } });
    fireEvent.change(screen.getByPlaceholderText(/group name/i), { target: { value: "new-group" } });
    fireEvent.click(screen.getByText("Create"));
    await vi.waitFor(() => {
      expect(onAddGroup).toHaveBeenCalledWith("new-group");
      expect(onGroup).toHaveBeenCalledWith("new-group");
    });
  });

  it("closes the dialog on Cancel", () => {
    render(<InfoPanel {...baseProps} groups={[]} />);
    const select = screen.getByLabelText(/group/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__add_group__" } });
    expect(screen.getByText("Add Group")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Add Group")).not.toBeInTheDocument();
  });
});
