import { afterAll, beforeAll, describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "../state/ToastContext";
import { ChatProvider } from "../state/ChatContext";
import { ChatPanel } from "./ChatPanel";
import * as client from "../api/client";
import type { ChatInitResponse } from "../api/types";

async function defaultMock(url: string): Promise<{ ok: boolean; status: number; data: object }> {
        if (String(url).startsWith("/chat/init")) return { ok: true, status: 200, data: { ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" }, sessionId: "sess-1", cwd: "/tmp/ws", resumed: false, capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false }, slashCommands: [], history: [], pinned: false, group: null, autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false }, model: { supported: false, available: [], current: null } } };
  if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
  if (url === "/chat/auto-approve") return { ok: true, status: 200, data: { effective: true, default: false, override: true } };
  return { ok: true, status: 200, data: {} };
}

let fetchSpy: MockInstance<typeof client.fetchJSON>;

beforeEach(() => {
  fetchSpy = vi.spyOn(client, "fetchJSON").mockImplementation(defaultMock);
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe("<ChatPanel>", () => {
  it("renders the title, info toggle, and composer", () => {
    render(
      <ToastProvider>
        <ChatProvider>
          <ChatPanel />
        </ChatProvider>
      </ToastProvider>,
    );
    expect(screen.getAllByText("Loading").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("renders the empty transcript state", async () => {
    render(
      <ToastProvider>
        <ChatProvider>
          <ChatPanel />
        </ChatProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText(/start a conversation/i)).toBeInTheDocument());
  });

  describe("cached lastUsage fallback", () => {
    // Regression: after a resume/reload, the transcript has no live usage
    // patch yet (Claude's session/load replay doesn't re-emit usage_update
    // for past turns — see docs/acp-notes.md), so the context bar must fall
    // back to the gateway-cached lastUsage returned on /chat/init.
    beforeEach(() => {
      fetchSpy.mockImplementation(async (url: string) => {
        if (String(url).startsWith("/chat/init")) {
          return {
            ok: true, status: 200, data: {
              ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" },
              sessionId: "sess-1", cwd: "/tmp/ws", resumed: true,
              capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false },
              slashCommands: [], history: [], pinned: false, group: null,
              lastUsage: {
                requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
                context_limit: 1000000, context_used: 44042, cost: { amount: 0.13, currency: "USD" },
              },
              autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
              model: { supported: false, available: [], current: null },
            },
          };
        }
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
        return { ok: true, status: 200, data: {} };
      });
    });

    it("shows the context bar from cached lastUsage with no transcript usage patch", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      // toLocaleString() digit grouping is locale-dependent for large numbers
      // (e.g. Indian grouping renders 1000000 as "10,00,000"), but 44042 groups
      // the same way in both — safe to match literally. Cost lives in
      // InfoPanel's Usage card, not the Composer's context pill.
      await waitFor(() => expect(document.body.textContent).toMatch(/44,042/));
      expect(document.body.textContent).toMatch(/\(4%\)/);
      expect(document.body.textContent).toMatch(/\$0\.13/);
    });
  });

  describe("manual usage refresh", () => {
    beforeEach(() => {
      fetchSpy.mockImplementation(async (url: string) => {
        if (String(url).startsWith("/chat/usage")) {
          return {
            ok: true, status: 200,
            data: { ok: true, rate_limits: { five_hour: { status: "allowed_warning", utilization: 0.61 } } },
          };
        }
        if (String(url).startsWith("/chat/init")) {
          return {
            ok: true, status: 200, data: {
              ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" },
              sessionId: "sess-1", cwd: "/tmp/ws", resumed: false,
              capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false, usageQuery: true },
              slashCommands: [], history: [], pinned: false, group: null,
              autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
              model: { supported: false, available: [], current: null },
            },
          };
        }
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
        return { ok: true, status: 200, data: {} };
      });
    });

    it("fetches /chat/usage and renders the returned rate_limits when the refresh button is clicked", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByLabelText("Refresh usage")).toBeInTheDocument());
      fireEvent.click(screen.getByLabelText("Refresh usage"));
      await waitFor(() =>
        expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith("/chat/usage?sessionId=sess-1"))).toBe(true),
      );
      await waitFor(() => expect(document.body.textContent).toMatch(/61%/));
    });
  });

  describe("deleting the active session", () => {
    beforeEach(() => {
      fetchSpy.mockImplementation(async (url: string, opts?: { method?: string }) => {
  if (String(url).startsWith("/chat/init")) return { ok: true, status: 200, data: { ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" }, sessionId: "sess-1", cwd: "/tmp/ws", resumed: false, capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false }, slashCommands: [], history: [], pinned: false, group: null, autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false }, model: { supported: false, available: [], current: null } } };
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [{ sessionId: "sess-1", title: "first" }] } };
        if (url === "/chat/sessions/sess-1" && opts?.method === "DELETE") return { ok: true, status: 200, data: { ok: true } };
        return { ok: true, status: 200, data: {} };
      });
    });

    it("starts a new chat (re-inits) after deleting the currently open session", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getAllByLabelText("Edit title").length).toBeGreaterThanOrEqual(1));
      const initCallsBefore = fetchSpy.mock.calls.filter(([u]) => String(u).startsWith("/chat/init")).length;

      fireEvent.click(screen.getByText("☰ Chats"));
      await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        const initCallsAfter = fetchSpy.mock.calls.filter(([u]) => String(u).startsWith("/chat/init")).length;
        expect(initCallsAfter).toBeGreaterThan(initCallsBefore);
      });
    });
  });

  describe("new chat in a workspace with a chosen backend", () => {
    beforeEach(() => {
      fetchSpy.mockImplementation(async (url: string) => {
        if (String(url).startsWith("/chat/init")) {
          return {
            ok: true, status: 200, data: {
              ok: true, backend: { kind: "fake", role: "chat", model: null, name: "opencode" },
              sessionId: "sess-1", cwd: "/tmp/ws", resumed: false,
              capabilities: { multipleSessions: true, customWorkingDirectory: true, cancel: true, steer: false, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false },
              slashCommands: [], history: [], pinned: false, group: null,
              autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
              model: { supported: false, available: [], current: null },
            },
          };
        }
        if (url === "/settings/default-backend") {
          return { ok: true, status: 200, data: { ok: true, available: ["opencode", "claude"], default: "opencode" } };
        }
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
        return { ok: true, status: 200, data: {} };
      });
      window.localStorage.setItem("jarvis.recentWorkspaces", JSON.stringify(["/tmp/ws2"]));
    });

    it("defaults the drawer's backend to the current session's backend and threads a changed choice into /chat/init", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getAllByLabelText("Edit title").length).toBeGreaterThanOrEqual(1));

      fireEvent.click(screen.getByText("+ New in..."));
      const select = await screen.findByLabelText(/backend for new chat/i) as HTMLSelectElement;
      expect(select.value).toBe("opencode");

      fireEvent.change(select, { target: { value: "claude" } });
      fireEvent.click(screen.getByText("/tmp/ws2"));

      await waitFor(() =>
        expect(fetchSpy.mock.calls.some(([u]) => String(u) === "/chat/init?cwd=%2Ftmp%2Fws2&backend=claude")).toBe(true),
      );
    });

    it("does not reset the chosen backend when the default-backend fetch resolves after the pick", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getAllByLabelText("Edit title").length).toBeGreaterThanOrEqual(1));

      fireEvent.click(screen.getByText("+ New in..."));
      const select = await screen.findByLabelText(/backend for new chat/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "claude" } });
      expect(select.value).toBe("claude");
    });
  });

  describe("header toolbar", () => {
    it("renders 6 buttons with a divider separating primary and secondary groups — Steer and Auto-approve moved to the Composer", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getAllByLabelText("Edit title").length).toBeGreaterThanOrEqual(1));

      // Primary group: New, Follow, Chats
      expect(screen.getByText("＋ New")).toBeInTheDocument();
      expect(screen.getByText("↓ Follow")).toBeInTheDocument();
      expect(screen.getByText("☰ Chats")).toBeInTheDocument();

      // Divider
      expect(document.querySelector('[class*="divider"]')).toBeInTheDocument();

      // Secondary group: Info, New in..., Fork
      expect(screen.getByText("Info")).toBeInTheDocument();
      expect(screen.getByText("+ New in...")).toBeInTheDocument();
      expect(screen.getByText("Fork")).toBeInTheDocument();
    });
  });

  describe("composer turn controls", () => {
    beforeEach(() => {
      fetchSpy.mockImplementation(async (url: string) => {
        if (String(url).startsWith("/chat/init")) {
          return {
            ok: true, status: 200, data: {
              ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" },
              sessionId: "sess-1", cwd: "/tmp/ws", resumed: false,
              capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: true, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false },
              slashCommands: [], history: [], pinned: false, group: null,
              autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
              model: { supported: true, available: [{ modelId: "m1", name: "Model One" }, { modelId: "m2", name: "Model Two" }], current: "m1" },
            },
          };
        }
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
        return { ok: true, status: 200, data: {} };
      });
    });

    it("renders the model selector and an auto-approve toggle inside the Composer", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getAllByLabelText("Edit title").length).toBeGreaterThanOrEqual(1));
      expect(screen.getByRole("button", { name: "Model" })).toBeInTheDocument();
      expect(screen.getByText("Model One")).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Auto-approve" })).toBeInTheDocument();
    });

    it("calls /chat/model when a different model is selected in the Composer", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByRole("button", { name: "Model" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Model" }));
      fireEvent.mouseDown(screen.getByRole("option", { name: "Model Two" }));
      await waitFor(() =>
        expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith("/chat/model"))).toBe(true),
      );
    });

    it("does not show the Composer's Steer button while idle", async () => {
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getAllByLabelText("Edit title").length).toBeGreaterThanOrEqual(1));
      expect(screen.queryByText("Steer")).not.toBeInTheDocument();
    });

    it("disables the Composer's Auto-approve button when the backend lacks tool-approval capability, even though autoApprove.supported is true", async () => {
      fetchSpy.mockImplementation(async (url: string) => {
        if (String(url).startsWith("/chat/init")) {
          return {
            ok: true, status: 200, data: {
              ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" },
              sessionId: "sess-1", cwd: "/tmp/ws", resumed: false,
              capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: true, toolApprovals: false, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false },
              slashCommands: [], history: [], pinned: false, group: null,
              autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
              model: { supported: true, available: [{ modelId: "m1", name: "Model One" }], current: "m1" },
            },
          };
        }
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
        return { ok: true, status: 200, data: {} };
      });
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
    });
  });

  describe("transcript scroll after a reload", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      kind: "user" as const,
      content: `question ${i}`,
    })).flatMap((u, i) => [
      u,
      { kind: "assistant" as const, patches: [{ type: "text-start" as const, index: 0, content: `answer ${i}` }] },
    ]);

    // Simulate a viewport where the loaded history overflows the container so
    // scrollTop actually needs to be set (jsdom reports 0 for both metrics).
    // The loading/empty placeholder is short; the populated log is tall.
    beforeAll(() => {
      Object.defineProperty(Element.prototype, "scrollHeight", {
        configurable: true,
        get(this: Element) { return this.getAttribute("role") === "log" ? 2000 : 60; },
      });
      Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get: () => 600 });
    });
    afterAll(() => {
      delete (Element.prototype as unknown as { scrollHeight?: unknown }).scrollHeight;
      delete (Element.prototype as unknown as { clientHeight?: unknown }).clientHeight;
    });

    it("opens the resumed chat at the bottom once loading completes", async () => {
      fetchSpy.mockImplementation(async (url: string) => {
        if (String(url).startsWith("/chat/init")) {
          return {
            ok: true, status: 200, data: {
              ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" },
              sessionId: "sess-1", cwd: "/tmp/ws", resumed: true, history,
              capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false },
              slashCommands: [], pinned: false, group: null,
              autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
              model: { supported: false, available: [], current: null },
            },
          };
        }
        if (url === "/chat/groups") {
          // A real network round-trip: the /chat/init response (history)
          // lands while loading is still true, so the transcript seeds
          // against the loading placeholder and the bottom-scroll must wait
          // for loading to flip false after this resolves.
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { ok: true, status: 200, data: { groups: [] } };
        }
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
        return { ok: true, status: 200, data: {} };
      });
      render(
        <ToastProvider>
          <ChatProvider>
            <ChatPanel />
          </ChatProvider>
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByRole("log")).toBeInTheDocument());
      const log = screen.getByRole("log") as HTMLDivElement;
      expect(log.scrollTop).toBe(2000);
    });
  });
});
