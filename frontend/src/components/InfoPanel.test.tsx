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
  state: baseState, title: "My chat", pinned: false,
  onRename: vi.fn(), onPinned: vi.fn(),
};

describe("<InfoPanel>", () => {
  it("renders session id, cwd, and slash count", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ws")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByLabelText(/model/i)).not.toBeInTheDocument();
  });

  it("renders the title as static text by default, not an input", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.getByText("My chat")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an accessible edit affordance for the title", () => {
    render(<InfoPanel {...baseProps} />);
    const trigger = screen.getByLabelText("Edit title");
    expect(trigger).toHaveAttribute("role", "button");
    expect(trigger).toHaveAttribute("tabIndex", "0");
  });

  it("enters edit mode on click and commits the new title on Enter", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    const input = screen.getByDisplayValue("My chat");
    fireEvent.change(input, { target: { value: "new title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("new title");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("enters edit mode via keyboard (Enter or Space on the trigger)", () => {
    render(<InfoPanel {...baseProps} />);
    fireEvent.keyDown(screen.getByLabelText("Edit title"), { key: "Enter" });
    expect(screen.getByDisplayValue("My chat")).toBeInTheDocument();
  });

  it("commits the new title on blur", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    const input = screen.getByDisplayValue("My chat");
    fireEvent.change(input, { target: { value: "blurred title" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("blurred title");
  });

  it("reverts without committing on Escape", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    const input = screen.getByDisplayValue("My chat");
    fireEvent.change(input, { target: { value: "discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("My chat")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not call onRename when the committed value is unchanged", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    fireEvent.keyDown(screen.getByDisplayValue("My chat"), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("commits an empty title", () => {
    const onRename = vi.fn();
    render(<InfoPanel {...baseProps} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit title"));
    const input = screen.getByDisplayValue("My chat");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("");
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

  it("renders cards in Chat identity -> Usage -> Session & workspace order", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { five_hour: { status: "allowed", utilization: 0.12 } },
        }}
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Current chat", "Usage", "Session & workspace"]);
  });

  it("merges workspace, session id, and slash count under one Session & workspace card", () => {
    render(<InfoPanel {...baseProps} />);
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Session")).not.toBeInTheDocument();
    expect(screen.getByText("Session & workspace")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ws")).toBeInTheDocument();
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders a progressbar with the correct value for each rate-limit window", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { five_hour: { status: "allowed", utilization: 0.12 } },
        }}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: /session \(5h\) usage/i });
    expect(bar).toHaveAttribute("aria-valuenow", "12");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("does not render a progressbar for a window with no numeric utilization", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { overage: { status: "rejected" } },
        }}
      />,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("prefixes the percentage with a warning glyph at >=80%, not just a color change", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { seven_day: { status: "allowed_warning", utilization: 0.86 } },
        }}
      />,
    );
    expect(screen.getByText("⚠ 86%")).toBeInTheDocument();
  });

  it("does not prefix the percentage with a warning glyph below 80%", () => {
    render(
      <InfoPanel
        {...baseProps}
        usage={{
          requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          rate_limits: { five_hour: { status: "allowed", utilization: 0.12 } },
        }}
      />,
    );
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });

});
