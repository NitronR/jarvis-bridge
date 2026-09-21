import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseCodexRateLimits, queryCodexUsageViaAppServer } from "./codexUsage";

describe("parseCodexRateLimits", () => {
  test("maps the live Codex five-hour window to the existing Session (5h) meter", () => {
    assert.deepEqual(parseCodexRateLimits({
      primary: { usedPercent: 60, windowDurationMins: 300, resetsAt: 1_789_203_050 },
    }), {
      five_hour: { status: "allowed", utilization: 0.6, resetsAt: 1_789_203_050_000 },
    });
  });
  // This catches a regression where the Codex app-server account response is
  // returned raw, or its seconds-based reset timestamp is exposed as ms.
  test("normalizes primary and weekly rate-limit windows for the shared usage UI", () => {
    const result = parseCodexRateLimits({
      limitId: "codex",
      limitReached: false,
      primary: {
        usedPercent: 35.5,
        windowDurationMins: 180,
        resetsAt: 1_700_000_000,
      },
      secondary: {
        usedPercent: 82,
        windowDurationMins: 10_080,
        resetsAt: 1_700_500_000,
      },
    });

    assert.deepEqual(result, {
      three_hour: {
        status: "allowed",
        utilization: 0.355,
        resetsAt: 1_700_000_000_000,
      },
      seven_day: {
        status: "allowed_warning",
        utilization: 0.82,
        resetsAt: 1_700_500_000_000,
      },
    });
  });
});

test("queries Codex app-server and unwraps its rateLimits envelope", async () => {
  const rateLimits = await queryCodexUsageViaAppServer({
    executable: "codex",
    cwd: "/tmp/workspace",
    readRateLimits: async () => ({
      rateLimits: {
        primary: { usedPercent: 12, windowDurationMins: 180, resetsAt: 1_700_000_000 },
      },
    }),
  });

  assert.deepEqual(rateLimits, {
    three_hour: {
      status: "allowed",
      utilization: 0.12,
      resetsAt: 1_700_000_000_000,
    },
  });
});

test("selects Codex's rate-limit snapshot from the app-server per-limit envelope", async () => {
  const rateLimits = await queryCodexUsageViaAppServer({
    executable: "codex",
    cwd: "/tmp/workspace",
    readRateLimits: async () => ({
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 100, windowDurationMins: 180, resetsAt: 1_700_000_000 },
        },
      },
    }),
  });

  assert.deepEqual(rateLimits, {
    three_hour: {
      status: "rejected",
      utilization: 1,
      resetsAt: 1_700_000_000_000,
    },
  });
});

test("starts Codex app-server and reads account/rateLimits/read over JSON-RPC", async () => {
  const rateLimits = await queryCodexUsageViaAppServer({
    executable: process.execPath,
    args: [path.resolve(process.cwd(), "test/fixtures/fake-codex-app-server.cjs")],
    cwd: process.cwd(),
  });

  assert.equal(rateLimits?.three_hour?.utilization, 0.44);
});
