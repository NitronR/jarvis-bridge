import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspacesDrawer } from "./WorkspacesDrawer";

describe("<WorkspacesDrawer>", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <WorkspacesDrawer
        open={false}
        recentWorkspaces={[]}
        onClose={vi.fn()}
        onOpenInWorkspace={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onPickFolder={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders empty state when open with no recent workspaces", () => {
    render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={[]}
        onClose={vi.fn()}
        onOpenInWorkspace={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onPickFolder={vi.fn()}
      />,
    );
    expect(screen.getByText(/no recent workspaces/i)).toBeInTheDocument();
  });

  it("renders each recent workspace path", () => {
    render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={["/home/user/projects/api-server", "/home/user/projects/web"]}
        onClose={vi.fn()}
        onOpenInWorkspace={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onPickFolder={vi.fn()}
      />,
    );
    expect(screen.getByText("/home/user/projects/api-server")).toBeInTheDocument();
    expect(screen.getByText("/home/user/projects/web")).toBeInTheDocument();
  });

  it("renders Open folder button at the top of the drawer", () => {
    render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={["/a/b/c"]}
        onClose={vi.fn()}
        onOpenInWorkspace={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onPickFolder={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: /open folder/i });
    const workspace = screen.getByText("/a/b/c");
    expect(button.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("calls onPickFolder when Open folder button is clicked", () => {
    const onPickFolder = vi.fn();
    render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={[]}
        onClose={vi.fn()}
        onOpenInWorkspace={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onPickFolder={onPickFolder}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));
    expect(onPickFolder).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenInWorkspace on plain click of a workspace card", () => {
    const onOpenInWorkspace = vi.fn();
    render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={["/a/b/c"]}
        onClose={vi.fn()}
        onOpenInWorkspace={onOpenInWorkspace}
        onOpenInNewTab={vi.fn()}
        onPickFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("/a/b/c"));
    expect(onOpenInWorkspace).toHaveBeenCalledWith("/a/b/c");
  });

  it("calls onOpenInNewTab on cmd/meta-click instead of onOpenInWorkspace", () => {
    const onOpenInWorkspace = vi.fn();
    const onOpenInNewTab = vi.fn();
    render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={["/a/b/c"]}
        onClose={vi.fn()}
        onOpenInWorkspace={onOpenInWorkspace}
        onOpenInNewTab={onOpenInNewTab}
        onPickFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("/a/b/c"), { metaKey: true });
    expect(onOpenInNewTab).toHaveBeenCalledWith("/a/b/c");
    expect(onOpenInWorkspace).not.toHaveBeenCalled();
  });

  it("calls onOpenInNewTab on ctrl-click", () => {
    const onOpenInWorkspace = vi.fn();
    const onOpenInNewTab = vi.fn();
    render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={["/a/b/c"]}
        onClose={vi.fn()}
        onOpenInWorkspace={onOpenInWorkspace}
        onOpenInNewTab={onOpenInNewTab}
        onPickFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("/a/b/c"), { ctrlKey: true });
    expect(onOpenInNewTab).toHaveBeenCalledWith("/a/b/c");
    expect(onOpenInWorkspace).not.toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={[]}
        onClose={onClose}
        onOpenInWorkspace={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onPickFolder={vi.fn()}
      />,
    );
    const backdrop = container.querySelector("[data-testid='workspaces-drawer-backdrop']") as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <WorkspacesDrawer
        open={true}
        recentWorkspaces={[]}
        onClose={onClose}
        onOpenInWorkspace={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onPickFolder={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});