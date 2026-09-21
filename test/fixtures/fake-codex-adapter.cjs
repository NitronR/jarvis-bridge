// Model codex-acp's normal ACP mode and its `cli app-server` passthrough.
if (process.argv[2] === "cli") {
  if (process.argv[3] !== "app-server") process.exit(2);
  require("./fake-codex-app-server.cjs");
} else {
  require("./fake-streaming-agent.cjs");
}
