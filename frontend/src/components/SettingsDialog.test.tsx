import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import * as client from "../api/client";

const CONFIG_DEFAULTS = {
  backends: [
    {
      name: "claude",
      options: [
        { id: "effort", name: "Effort", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
      ],
      defaults: { effort: "high" },
    },
    { name: "opencode", options: [], defaults: {} },
  ],
};

describe("<SettingsDialog>", () => {
  let fetchJSONSpy: MockInstance<typeof client.fetchJSON>;
  beforeEach(() => {
    window.localStorage.clear();
    fetchJSONSpy = vi.spyOn(client, "fetchJSON").mockImplementation(async (url: string) => {
      if (url === "/settings/default-backend") {
        return { ok: true, status: 200, data: { available: ["claude", "opencode"], default: "claude" } };
      }
      if (url === "/settings/config-defaults") {
        return { ok: true, status: 200, data: CONFIG_DEFAULTS };
      }
      return { ok: true, status: 200, data: { ok: true, defaults: {} } };
    });
  });
  afterEach(() => {
    fetchJSONSpy.mockRestore();
    window.localStorage.clear();
  });

  it("renders a select per catalogued option, set to the current default", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const select = await screen.findByLabelText("claude — Effort");
    expect((select as HTMLSelectElement).value).toBe("high");
  });

  it("prompts to start a chat for a backend with no catalog", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    expect(await screen.findByText(/start a chat on this backend/i)).toBeInTheDocument();
  });

  it("PUTs the picked value", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const select = await screen.findByLabelText("claude — Effort");
    fireEvent.change(select, { target: { value: "low" } });
    await waitFor(() => {
      expect(fetchJSONSpy).toHaveBeenCalledWith("/settings/config-default", {
        method: "PUT",
        body: { backend: "claude", configId: "effort", value: "low" },
      });
    });
  });

  it("PUTs null when the agent default is picked", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const select = await screen.findByLabelText("claude — Effort");
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => {
      expect(fetchJSONSpy).toHaveBeenCalledWith("/settings/config-default", {
        method: "PUT",
        body: { backend: "claude", configId: "effort", value: null },
      });
    });
  });
});
