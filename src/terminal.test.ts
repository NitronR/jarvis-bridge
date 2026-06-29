import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { attachTerminalServer } from "./terminal";
import { WebSocket } from "ws";

test("attachTerminalServer: ws client receives echoed input and exit JSON", async () => {
  const httpServer = createServer();
  attachTerminalServer({ server: httpServer, workspace: process.cwd(), enabled: true });
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const port = (httpServer.address() as { port: number }).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
  const chunks: string[] = [];
  let exitJson: { type?: string; code?: number } | null = null;
  ws.on("message", (data) => {
    const s = data.toString("utf8");
    if (s.startsWith("{")) {
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === "object") exitJson = parsed as { type?: string; code?: number };
      } catch { /* not a json frame */ }
    } else {
      chunks.push(s);
    }
  });

  await new Promise<void>((r) => ws.once("open", r));
  ws.send("echo JB_PTY_OK\nexit\n");

  const echoDeadline = Date.now() + 4000;
  while (!chunks.join("").includes("JB_PTY_OK") && Date.now() < echoDeadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const exitDeadline = Date.now() + 4000;
  while (!exitJson && Date.now() < exitDeadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.ok(chunks.join("").includes("JB_PTY_OK"), `expected echo, got: ${chunks.join("").slice(0, 300)}`);
  assert.ok(exitJson, "expected exit JSON frame");
  assert.equal(exitJson!.type, "exit");
  assert.equal(typeof exitJson!.code, "number");

  ws.close();
  await new Promise<void>((r) => httpServer.close(() => r()));
});
