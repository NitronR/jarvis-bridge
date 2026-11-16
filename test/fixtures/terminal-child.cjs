// A deterministic PTY process: no login-shell startup files or external commands.
const readline = require("node:readline");

// Shutdown must also close WebSockets if a process does not report its exit.
process.on("SIGHUP", () => {});

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (line === "exit") process.exit(7);
  process.stdout.write(`received: ${line}\n`);
});

process.stdout.write("JB_PTY_READY\n");
