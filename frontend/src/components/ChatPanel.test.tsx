import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "../state/ToastContext";
import { ChatProvider } from "../state/ChatContext";
import { ChatPanel } from "./ChatPanel";
import * as client from "../api/client";
import type { ChatInitResponse } from "../api/types";

async function defaultMock(url: string): Promise<{ ok: boolean; status: number; data: object }> {
        if (String(url).startsWith("/chat/init")) return { ok: true, status: 200, data: { ok: true, backend: { kind: "fake", role: "chat", model: null, name: "fake" }, sessionId: "sess-1", cwd: "/tmp/ws", resumed: false, capabilities: { multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false, toolApprovals: true, slashCommands: false, canFork: true, images: false, sessionDelete: true, promptQueueing: false }, slashCommands: [], history: [], pinned: false, group: null, autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false }, model: { supported: false, available: [], current: null } } };
  if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [] } };
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
    expect(screen.getByText("Loading")).toBeInTheDocument();
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
      // toLocaleString() digit grouping is locale-dependent (e.g. Indian
      // grouping renders 1000000 as "10,00,000"), so match on the
      // context-bar prefix/suffix rather than a hardcoded grouping.
      await waitFor(() => expect(document.body.textContent).toMatch(/Context: 44,042/));
      expect(document.body.textContent).toMatch(/\(4%\)/);
      expect(document.body.textContent).toMatch(/\$0\.13/);
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
      await waitFor(() => expect(screen.getByText("New chat")).toBeInTheDocument());
      const initCallsBefore = fetchSpy.mock.calls.filter(([u]) => String(u).startsWith("/chat/init")).length;

      fireEvent.click(screen.getByText("Chats"));
      await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        const initCallsAfter = fetchSpy.mock.calls.filter(([u]) => String(u).startsWith("/chat/init")).length;
        expect(initCallsAfter).toBeGreaterThan(initCallsBefore);
      });
    });
  });
});
