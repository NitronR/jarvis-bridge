import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "../state/ToastContext";
import { ChatPanel } from "./ChatPanel";
import * as client from "../api/client";
import type { ChatInitResponse } from "../api/types";

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

  describe("deleting the active session", () => {
    let fetchJSONSpy: ReturnType<typeof vi.spyOn>;

    const baseInit: ChatInitResponse = {
      ok: true,
      backend: { kind: "fake", role: "chat", model: null },
      sessionId: "sess-1",
      cwd: "/tmp/ws",
      resumed: false,
      capabilities: {
        multipleSessions: true, customWorkingDirectory: false, cancel: true, steer: false,
        toolApprovals: true, slashCommands: false, canFork: true, images: false,
        sessionDelete: true, promptQueueing: false,
      },
      slashCommands: [], history: [],
      autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
      model: { supported: false, available: [], current: null },
    };

    beforeEach(() => {
      fetchJSONSpy = vi.spyOn(client, "fetchJSON").mockImplementation(async (url: string, opts?: { method?: string }) => {
        if (url.startsWith("/chat/init")) return { ok: true, status: 200, data: baseInit };
        if (url === "/chat/sessions") return { ok: true, status: 200, data: { sessions: [{ sessionId: "sess-1", title: "first" }] } };
        if (url === "/chat/sessions/sess-1" && opts?.method === "DELETE") return { ok: true, status: 200, data: { ok: true } };
        return { ok: true, status: 200, data: {} };
      });
    });

    afterEach(() => { fetchJSONSpy.mockRestore(); });

    it("starts a new chat (re-inits) after deleting the currently open session", async () => {
      render(
        <ToastProvider>
          <ChatPanel />
        </ToastProvider>,
      );
      await waitFor(() => expect(screen.getByText("New chat")).toBeInTheDocument());
      const initCallsBefore = fetchJSONSpy.mock.calls.filter(([u]) => String(u).startsWith("/chat/init")).length;

      fireEvent.click(screen.getByText("Chats"));
      await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        const initCallsAfter = fetchJSONSpy.mock.calls.filter(([u]) => String(u).startsWith("/chat/init")).length;
        expect(initCallsAfter).toBeGreaterThan(initCallsBefore);
      });
    });
  });
});
