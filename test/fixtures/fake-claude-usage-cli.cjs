#!/usr/bin/env node
// Fake `claude` CLI standing in for `claude --print --output-format json
// "/usage"` — used to test queryClaudeUsageViaCli's real (non-injected)
// execFile path end-to-end, without spawning the real Claude CLI.
//
//   X_FAKE_CLAUDE_USAGE_TEXT — the `result` string to emit (default: a
//                              canned "Current session"/"Current week" blob)
//   X_FAKE_CLAUDE_USAGE_EXIT_CODE — process exit code (default: 0)

const args = process.argv.slice(2);
if (args[0] !== "--print" || args[1] !== "--output-format" || args[2] !== "json" || args[3] !== "/usage") {
  process.stderr.write(`fake-claude-usage-cli: unexpected args ${JSON.stringify(args)}\n`);
  process.exit(1);
}

const exitCode = Number(process.env.X_FAKE_CLAUDE_USAGE_EXIT_CODE ?? "0");
const result =
  process.env.X_FAKE_CLAUDE_USAGE_TEXT ??
  "Current session: 33% used · resets Jul 16 at 9am (UTC)\nCurrent week (all models): 4% used · resets Jul 23 at 12am (UTC)";

process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result }));
process.exit(exitCode);
