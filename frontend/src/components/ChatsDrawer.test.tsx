import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatsDrawer } from "./ChatsDrawer";

describe("<ChatsDrawer>", () => {
  // Some tests below (e.g. the workspace filter select) write to the real,
  // process-wide localStorage stub via user interaction rather than a
  // per-test override. Clear it after every test so a filter/tab choice
  // made by one test can't leak into the next test's default render.
  afterEach(() => {
    window.localStorage?.clear();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ChatsDrawer open={false} sessions={[]} onClose={vi.fn()} onSwitch={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders empty state when open with no sessions", () => {
    render(<ChatsDrawer open={true} sessions={[]} onClose={vi.fn()} onSwitch={vi.fn()} />);
    expect(screen.getByText(/no past chats yet/i)).toBeInTheDocument();
  });

  it("renders each session title and calls onSwitch on click", () => {
    const onSwitch = vi.fn();
    render(
      <ChatsDrawer
        open={true}
        sessions={[
          { sessionId: "s1", title: "first", customTitle: "Alpha work" },
          { sessionId: "s2", title: "Second session" },
        ]}
        onClose={vi.fn()}
        onSwitch={onSwitch}
      />,
    );
    expect(screen.getByText("Alpha work")).toBeInTheDocument();
    expect(screen.getByText("Second session")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Second session"));
    expect(onSwitch).toHaveBeenCalledWith("s2");
  });

  it("renders backend badge when backendName is provided", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "t", backendName: "claude" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
      />,
    );
    expect(screen.getByText("claude")).toBeInTheDocument();
  });

  it("renders workspace (cwd basename) on each card", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "t", cwd: "/home/user/projects/api-server" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
      />,
    );
    expect(screen.getAllByText("api-server").length).toBeGreaterThan(0);
  });

  it("renders group tag when group is set", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "t", group: "bugfix" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
      />,
    );
    expect(screen.getByText("bugfix")).toBeInTheDocument();
  });

  it("renders a turn count pill when getTurnCount returns a positive count", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "t" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
        getTurnCount={(sessionId) => (sessionId === "s1" ? 4 : undefined)}
      />,
    );
    expect(screen.getByText("4 msgs")).toBeInTheDocument();
  });

  it("omits the turn count pill when the count is 0", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "t" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
        getTurnCount={() => 0}
      />,
    );
    expect(screen.queryByText(/msgs/)).toBeNull();
  });

  it("omits the turn count pill when getTurnCount is not provided or returns undefined", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "t" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
      />,
    );
    expect(screen.queryByText(/msgs/)).toBeNull();
  });

  it("renders a pin pill with pin icon when pinned is true", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "t", pinned: true }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/pinned/i)).toBeInTheDocument();
  });

  it("does not render a pin pill when pinned is false/unset", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "t" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/pinned/i)).toBeNull();
  });

  it("renders Delete button per session when canDelete is true", () => {
    const onDelete = vi.fn();
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "Test" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
        onDelete={onDelete}
        canDelete={true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("omits Delete button when canDelete is false", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "Test" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
        canDelete={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("renders a Pin button when unpinned and calls onTogglePin(id, true) on click", () => {
    const onTogglePin = vi.fn();
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "Test" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
        onTogglePin={onTogglePin}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pin chat/i }));
    expect(onTogglePin).toHaveBeenCalledWith("s1", true);
  });

  it("renders an Unpin button when pinned and calls onTogglePin(id, false) on click", () => {
    const onTogglePin = vi.fn();
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "Test", pinned: true }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
        onTogglePin={onTogglePin}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unpin chat/i }));
    expect(onTogglePin).toHaveBeenCalledWith("s1", false);
  });

  it("clicking the pin toggle does not also trigger onSwitch", () => {
    const onSwitch = vi.fn();
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "Test" }]}
        onClose={vi.fn()}
        onSwitch={onSwitch}
        onTogglePin={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pin chat/i }));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("omits the pin toggle button when onTogglePin is not provided", () => {
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "Test" }]}
        onClose={vi.fn()}
        onSwitch={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /pin chat/i })).toBeNull();
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ChatsDrawer
        open={true}
        sessions={[]}
        onClose={onClose}
        onSwitch={vi.fn()}
      />,
    );
    const backdrop = container.querySelector("[data-testid='chats-drawer-backdrop']") as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <ChatsDrawer open={true} sessions={[]} onClose={onClose} onSwitch={vi.fn()} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenInNewTab instead of onSwitch on cmd/meta-click", () => {
    const onSwitch = vi.fn();
    const onOpenInNewTab = vi.fn();
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "T" }]}
        onClose={vi.fn()}
        onSwitch={onSwitch}
        onOpenInNewTab={onOpenInNewTab}
      />,
    );
    fireEvent.click(screen.getByText("T"), { metaKey: true });
    expect(onOpenInNewTab).toHaveBeenCalledWith("s1");
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("calls onOpenInNewTab on ctrl-click (Windows/Linux equivalent)", () => {
    const onSwitch = vi.fn();
    const onOpenInNewTab = vi.fn();
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "T" }]}
        onClose={vi.fn()}
        onSwitch={onSwitch}
        onOpenInNewTab={onOpenInNewTab}
      />,
    );
    fireEvent.click(screen.getByText("T"), { ctrlKey: true });
    expect(onOpenInNewTab).toHaveBeenCalledWith("s1");
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("falls back to onSwitch when onOpenInNewTab is not provided (modifier click is ignored)", () => {
    const onSwitch = vi.fn();
    render(
      <ChatsDrawer
        open={true}
        sessions={[{ sessionId: "s1", title: "T" }]}
        onClose={vi.fn()}
        onSwitch={onSwitch}
      />,
    );
    fireEvent.click(screen.getByText("T"), { metaKey: true });
    expect(onSwitch).toHaveBeenCalledWith("s1");
  });

  describe("workspace filter dropdown", () => {
    type FilterProps = { recentWorkspaces?: string[] };
    const renderWith = (props: FilterProps = {}) => {
      const utils = render(
        <ChatsDrawer
          open={true}
          sessions={[
            { sessionId: "s1", title: "Alpha", cwd: "/home/u/proj/api" },
            { sessionId: "s2", title: "Beta", cwd: "/home/u/proj/api" },
            { sessionId: "s3", title: "Gamma", cwd: "/home/u/proj/web" },
            { sessionId: "s4", title: "Delta" },
          ]}
          onClose={vi.fn()}
          onSwitch={vi.fn()}
          {...props}
        />,
      );
      const select = screen.getByLabelText(/workspace/i) as HTMLSelectElement;
      return { ...utils, select };
    };

    it("renders a workspace dropdown with All + each unique basename from sessions and recents", () => {
      const { select } = renderWith({ recentWorkspaces: ["/home/u/proj/other"] });
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain("__all__");
      expect(options).toContain("api");
      expect(options).toContain("web");
      expect(options).toContain("other");
    });

    it("defaults the dropdown to All and shows every session", () => {
      renderWith();
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
      expect(screen.getByText("Gamma")).toBeInTheDocument();
      expect(screen.getByText("Delta")).toBeInTheDocument();
    });

    it("filters the visible sessions when a workspace is selected", () => {
      const { select } = renderWith();
      fireEvent.change(select, { target: { value: "api" } });
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
      expect(screen.queryByText("Gamma")).toBeNull();
      expect(screen.queryByText("Delta")).toBeNull();
    });

    it("shows a no-match message when the selected workspace has no chats", () => {
      const { select } = renderWith({ recentWorkspaces: ["/home/u/proj/empty"] });
      fireEvent.change(select, { target: { value: "empty" } });
      expect(screen.queryByText("Alpha")).toBeNull();
      expect(screen.getByText(/no chats in this workspace/i)).toBeInTheDocument();
    });

    it("persists the selected workspace to localStorage", () => {
      const store = new Map<string, string>();
      const original = (globalThis as { localStorage?: Storage }).localStorage;
      (globalThis as { localStorage?: Storage }).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: () => null,
        length: 0,
      };
      try {
        const { select } = renderWith();
        fireEvent.change(select, { target: { value: "web" } });
        expect(store.get("jarvis.lastChatsFilter")).toBe("web");
      } finally {
        (globalThis as { localStorage?: Storage }).localStorage = original;
      }
    });

    it("restores the selected workspace from localStorage on open", () => {
      const store = new Map<string, string>();
      store.set("jarvis.lastChatsFilter", "api");
      const original = (globalThis as { localStorage?: Storage }).localStorage;
      (globalThis as { localStorage?: Storage }).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: () => null,
        length: 0,
      };
      try {
        const { select } = renderWith();
        expect(select.value).toBe("api");
        expect(screen.queryByText("Gamma")).toBeNull();
      } finally {
        (globalThis as { localStorage?: Storage }).localStorage = original;
      }
    });
  });

  describe("Groups tab", () => {
    const renderWithGroups = (props: { sessions?: any[]; groups?: string[] } = {}) => {
      const sessions = props.sessions ?? [
        { sessionId: "s1", title: "Alpha", group: "bugfix" },
        { sessionId: "s2", title: "Beta", group: "bugfix" },
        { sessionId: "s3", title: "Gamma", group: "feature" },
        { sessionId: "s4", title: "Delta" },
      ];
      return render(
        <ChatsDrawer
          open={true}
          sessions={sessions}
          groups={props.groups ?? ["bugfix", "feature", "research"]}
          onClose={vi.fn()}
          onSwitch={vi.fn()}
        />,
      );
    };

    it("renders Chats and Groups tabs", () => {
      renderWithGroups();
      expect(screen.getByRole("button", { name: "Chats" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Groups" })).toBeInTheDocument();
    });

    it("defaults to Chats tab showing flat list", () => {
      renderWithGroups();
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    it("switches to Groups tab showing grouped sessions", () => {
      renderWithGroups();
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      expect(screen.getByText("bugfix")).toBeInTheDocument();
      expect(screen.getByText("feature")).toBeInTheDocument();
      expect(screen.getByText("research")).toBeInTheDocument();
    });

    it("shows Ungrouped section for sessions without a group", () => {
      renderWithGroups();
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      expect(screen.getByText("Ungrouped")).toBeInTheDocument();
    });

    it("expands a group to reveal its sessions on click", () => {
      renderWithGroups();
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      // Initially sessions under groups should not be visible
      expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
      // Click bugfix group header
      fireEvent.click(screen.getByText("bugfix"));
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    it("shows session count badge on group headers", () => {
      renderWithGroups();
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      expect(screen.getByText("2")).toBeInTheDocument(); // 2 sessions in bugfix
    });

    it("calls onSwitch when a session card is clicked in Groups tab", () => {
      const onSwitch = vi.fn();
      render(
        <ChatsDrawer
          open={true}
          sessions={[
            { sessionId: "s1", title: "Alpha", group: "bugfix" },
          ]}
          groups={["bugfix"]}
          onClose={vi.fn()}
          onSwitch={onSwitch}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      fireEvent.click(screen.getByText("bugfix"));
      fireEvent.click(screen.getByText("Alpha"));
      expect(onSwitch).toHaveBeenCalledWith("s1");
    });

    it("calls onOpenInNewTab instead of onSwitch on cmd/ctrl-click of a Groups-tab session card", () => {
      const onSwitch = vi.fn();
      const onOpenInNewTab = vi.fn();
      render(
        <ChatsDrawer
          open={true}
          sessions={[
            { sessionId: "s1", title: "Alpha", group: "bugfix" },
          ]}
          groups={["bugfix"]}
          onClose={vi.fn()}
          onSwitch={onSwitch}
          onOpenInNewTab={onOpenInNewTab}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      fireEvent.click(screen.getByText("bugfix"));
      fireEvent.click(screen.getByText("Alpha"), { metaKey: true });
      expect(onOpenInNewTab).toHaveBeenCalledWith("s1");
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it("ignores Chats-tab workspace/backend/search filters when bucketing the Groups tab", () => {
      render(
        <ChatsDrawer
          open={true}
          sessions={[
            { sessionId: "s1", title: "Alpha", group: "bugfix", cwd: "/home/u/proj/api" },
            { sessionId: "s2", title: "Beta", group: "bugfix", cwd: "/home/u/proj/web" },
            { sessionId: "s3", title: "Gamma", group: "feature", cwd: "/home/u/proj/web" },
            { sessionId: "s4", title: "Delta", cwd: "/home/u/proj/web" },
          ]}
          groups={["bugfix", "feature"]}
          onClose={vi.fn()}
          onSwitch={vi.fn()}
        />,
      );
      // Narrow the Chats tab to a single workspace ("api") while still on the Chats tab.
      const select = screen.getByLabelText(/workspace/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "api" } });
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();

      // Switch to Groups tab: bucketing must ignore the workspace filter above.
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      expect(screen.getByText("bugfix")).toBeInTheDocument();
      fireEvent.click(screen.getByText("bugfix"));
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();

      fireEvent.click(screen.getByText("feature"));
      expect(screen.getByText("Gamma")).toBeInTheDocument();

      expect(screen.getByText("Ungrouped")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Ungrouped"));
      expect(screen.getByText("Delta")).toBeInTheDocument();
    });

    it("sorts sessions within an expanded group by updatedAt descending, ignoring pinned", () => {
      render(
        <ChatsDrawer
          open={true}
          sessions={[
            { sessionId: "s1", title: "Oldest", group: "bugfix", updatedAt: "2026-01-01T00:00:00.000Z", pinned: false },
            { sessionId: "s2", title: "Newest", group: "bugfix", updatedAt: "2026-03-01T00:00:00.000Z", pinned: false },
            { sessionId: "s3", title: "Middle", group: "bugfix", updatedAt: "2026-02-01T00:00:00.000Z", pinned: true },
          ]}
          groups={["bugfix"]}
          onClose={vi.fn()}
          onSwitch={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      fireEvent.click(screen.getByText("bugfix"));
      const titles = screen.getAllByText(/Oldest|Newest|Middle/).map((el) => el.textContent);
      expect(titles).toEqual(["Newest", "Middle", "Oldest"]);
    });
  });
});