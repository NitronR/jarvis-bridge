import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJSON } from "./client";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchJSON", () => {
  it("parses a JSON 200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await fetchJSON("/test");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, value: 42 });
  });

  it("stringifies a body object", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = spy;
    await fetchJSON("/test", { method: "POST", body: { x: 1 } });
    expect(spy).toHaveBeenCalledWith("/test", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json" }),
      body: JSON.stringify({ x: 1 }),
    }));
  });

  it("returns status on 4xx without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "no" }), { status: 404 }),
    );
    const res = await fetchJSON("/missing");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.data).toEqual({ error: "no" });
  });

  it("falls back to text when body isn't JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("plain text", { status: 200 }));
    const res = await fetchJSON("/text");
    expect(res.data).toBe("plain text");
  });
});