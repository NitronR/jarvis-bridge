const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { version: "1" } })}\n`);
  }
  if (message.method === "account/rateLimits/read") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        rateLimits: {
          primary: { usedPercent: 44, windowDurationMins: 180, resetsAt: 1_700_000_000 },
        },
      },
    })}\n`);
  }
});
