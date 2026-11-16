import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { attachTerminalServer } from "./terminal";
import { WebSocket } from "ws";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";

const pty: typeof import("@homebridge/node-pty-prebuilt-multiarch") = require("@homebridge/node-pty-prebuilt-multiarch");

function waitForFrame(ws: WebSocket, frames: string[], matches: (frame: string) => boolean): Promise<string> {
  const existing = frames.find(matches);
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onMessage = (data: Buffer) => {
      const frame = data.toString("utf8");
      if (!matches(frame)) return;
      cleanup();
      resolve(frame);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error("WebSocket closed before the expected terminal frame")); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`expected terminal frame; received: ${JSON.stringify(frames)}`));
    }, 5000);
    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

async function terminalHarness(t: TestContext) {
  const spawn = pty.spawn.bind(pty);
  let child: IPty | undefined;
  // Keep the real native PTY and WebSocket transport. Only replace the user's
  // login shell with a controlled process, independent of startup dotfiles.
  t.mock.method(pty, "spawn", (_file: string, _args: string[], options: object) => {
    child = spawn(process.execPath, [path.resolve("test/fixtures/terminal-child.cjs")], options);
    return child;
  });
  const server = createServer();
  const terminal = attachTerminalServer({ server, workspace: process.cwd(), enabled: true });
  let ws: WebSocket | undefined;
  // Register before setup can fail; assertions and frame timeouts must not
  // leave upgraded sockets, the HTTP listener, or the child process running.
  t.after(async () => {
    ws?.terminate();
    try { child?.kill("SIGKILL"); } catch { /* already exited */ }
    try {
      await terminal.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const socket = ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
  const frames: string[] = [];
  socket.on("message", (data) => frames.push(data.toString("utf8")));
  const waitFor = (matches: (frame: string) => boolean) => waitForFrame(socket, frames, matches);
  // PTY text may be split across several WebSocket messages.
  const waitForOutput = (text: string) => waitFor(() => frames.join("").includes(text));
  await waitForOutput("JB_PTY_READY");
  return { ws: socket, terminal, waitFor, waitForOutput };
}

test("terminal forwards PTY input/output and the process exit status before closing", { timeout: 10000 }, async (t) => {
  const { ws, waitFor, waitForOutput } = await terminalHarness(t);
  const output = waitForOutput("received: hello");
  ws.send("hello\n");
  await output; // The input's own terminal echo cannot satisfy this assertion.

  const exit = waitFor((frame) => {
    try { return JSON.parse(frame).type === "exit"; } catch { return false; }
  });
  const closed = new Promise<number>((resolve) => ws.once("close", resolve));
  ws.send("exit\n");
  const result = JSON.parse(await exit);
  assert.equal(result.type, "exit");
  assert.equal(result.code, 7);
  assert.equal(await closed, 1000);
});

test("terminal shutdown closes an open WebSocket even without a PTY exit notification", { timeout: 10000 }, async (t) => {
  const { ws, terminal } = await terminalHarness(t);
  const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([terminal.close(), closed]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("shutdown waited for the PTY to close its WebSocket")), 5000);
      }),
    ]);
    assert.equal(ws.readyState, WebSocket.CLOSED);
  } finally {
    clearTimeout(timer);
  }
});
