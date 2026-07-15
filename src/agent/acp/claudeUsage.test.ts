import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeUsageText, queryClaudeUsageViaCli } from "./claudeUsage";

// Real `/usage` output captured via `claude --print --output-format json
// "/usage"` during the session that built this feature (see
// docs/agent-claude-code.md §6).
const REAL_USAGE_TEXT = `You are currently using your subscription to power your Claude Code usage

Current session: 82% used · resets Jul 15 at 2pm (Asia/Calcutta)
Current week (all models): 7% used · resets Jul 22 at 2:30am (Asia/Calcutta)
Current week (Fable): 0% used

What's contributing to your limits usage?`;

describe("parseClaudeUsageText", () => {
  test("extracts five_hour and seven_day windows from real captured output", () => {
    const r = parseClaudeUsageText(REAL_USAGE_TEXT);
    assert.ok(r);
    assert.deepEqual(r!.five_hour, {
      status: "allowed_warning",
      utilization: 0.82,
      resetsAtText: "Jul 15 at 2pm (Asia/Calcutta)",
    });
    assert.deepEqual(r!.seven_day, {
      status: "allowed",
      utilization: 0.07,
      resetsAtText: "Jul 22 at 2:30am (Asia/Calcutta)",
    });
  });

  test("derives status from the 80%/100% thresholds", () => {
    const low = parseClaudeUsageText("Current session: 5% used");
    assert.equal(low?.five_hour?.status, "allowed");
    const warn = parseClaudeUsageText("Current session: 80% used");
    assert.equal(warn?.five_hour?.status, "allowed_warning");
    const rejected = parseClaudeUsageText("Current session: 100% used");
    assert.equal(rejected?.five_hour?.status, "rejected");
  });

  // "Current week (Fable): 0% used" is a per-model breakdown line, not the
  // aggregate "(all models)" line — deliberately not parsed into any
  // rateLimitType (there's no clean SDK-shaped slot for it).
  test("ignores per-model weekly breakdown lines", () => {
    const r = parseClaudeUsageText("Current week (Fable): 0% used");
    assert.equal(r, null);
  });

  test("returns null when no recognizable usage lines are present", () => {
    assert.equal(parseClaudeUsageText("some unrelated CLI output"), null);
  });

  test("omits resetsAtText when the line has no reset clause", () => {
    const r = parseClaudeUsageText("Current session: 42% used");
    assert.equal(r?.five_hour?.utilization, 0.42);
    assert.equal(r?.five_hour?.resetsAtText, undefined);
  });
});

describe("queryClaudeUsageViaCli", () => {
  test("spawns the executable with --print --output-format json /usage and parses the result field", async () => {
    let capturedFile: string | undefined;
    let capturedArgs: readonly string[] | undefined;
    const r = await queryClaudeUsageViaCli({
      executable: "claude",
      cwd: "/tmp/ws",
      execFile: async (file, args) => {
        capturedFile = file;
        capturedArgs = args;
        return {
          stdout: JSON.stringify({
            type: "result",
            result: "Current session: 10% used · resets Jul 16 at 3am (UTC)",
          }),
        };
      },
    });
    assert.equal(capturedFile, "claude");
    assert.deepEqual(capturedArgs, ["--print", "--output-format", "json", "/usage"]);
    assert.equal(r?.five_hour?.utilization, 0.1);
  });

  test("throws a clear error when stdout is not valid JSON", async () => {
    await assert.rejects(
      () =>
        queryClaudeUsageViaCli({
          executable: "claude",
          cwd: "/tmp/ws",
          execFile: async () => ({ stdout: "not json" }),
        }),
      /non-JSON/,
    );
  });

  test("throws a clear error when the JSON has no string result field", async () => {
    await assert.rejects(
      () =>
        queryClaudeUsageViaCli({
          executable: "claude",
          cwd: "/tmp/ws",
          execFile: async () => ({ stdout: JSON.stringify({ type: "result" }) }),
        }),
      /no text result/,
    );
  });

  test("propagates exec failures (e.g. executable not found) untouched", async () => {
    await assert.rejects(
      () =>
        queryClaudeUsageViaCli({
          executable: "claude",
          cwd: "/tmp/ws",
          execFile: async () => {
            throw new Error("spawn claude ENOENT");
          },
        }),
      /ENOENT/,
    );
  });
});
