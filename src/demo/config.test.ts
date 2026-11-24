import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_DEMO_CONFIG_PATH,
  DEFAULT_TIMING,
  findScenario,
  isAskUserToolName,
  loadDemoConfig,
  parseDemoConfig,
} from "./config";

function scenario(firstMessage: string, name = firstMessage): unknown {
  return { name, firstMessage, responses: [{ parts: [{ type: "text", text: `reply to ${firstMessage}` }] }] };
}

function expectInvalid(raw: unknown, ...fragments: string[]): void {
  assert.throws(
    () => parseDemoConfig(raw),
    (err: Error) => {
      for (const f of fragments) assert.ok(err.message.includes(f), `expected "${f}" in:\n${err.message}`);
      return true;
    },
  );
}

test("the shipped demo/demo-config.json is valid", async () => {
  const cfg = await loadDemoConfig(DEFAULT_DEMO_CONFIG_PATH);
  assert.ok(cfg.scenarios.length > 0);
  // It must keep demonstrating the question dialog.
  const hasAskUser = cfg.scenarios.some((s) =>
    s.responses.some((r) => r.parts.some((p) => p.type === "tool_call" && isAskUserToolName(p.name))),
  );
  assert.ok(hasAskUser, "expected at least one AskUserQuestion scenario");
});

test("the main README lists every shipped scenario with its trigger message", async () => {
  const cfg = await loadDemoConfig(DEFAULT_DEMO_CONFIG_PATH);
  const readme = await fs.readFile(path.resolve(__dirname, "..", "..", "README.md"), "utf8");
  const rows = readme.split("\n").filter((l) => l.startsWith("| "));
  for (const s of cfg.scenarios) {
    assert.ok(
      rows.some((row) => row.startsWith(`| ${s.name} |`) && row.includes(`\`${s.firstMessage}\``)),
      `README.md's demo scenario table is missing "${s.name}" (trigger \`${s.firstMessage}\`) — update it`,
    );
  }
});

test("parseDemoConfig fills in default timing and keeps overrides", () => {
  assert.deepEqual(parseDemoConfig({ scenarios: [scenario("hi")] }).timing, DEFAULT_TIMING);
  const cfg = parseDemoConfig({ timing: { textChunkDelayMs: 0 }, scenarios: [scenario("hi")] });
  assert.deepEqual(cfg.timing, { ...DEFAULT_TIMING, textChunkDelayMs: 0 });
});

test("parseDemoConfig accepts text and tool_call parts", () => {
  const cfg = parseDemoConfig({
    scenarios: [
      {
        name: "tools",
        firstMessage: "go",
        responses: [
          {
            parts: [
              { type: "text", text: "hi", delayMs: 5 },
              { type: "tool_call", name: "Read", title: "Read a.ts", kind: "read", input: { p: 1 }, output: "x" },
              { type: "tool_call", name: "Bash", status: "failed", error: "boom", durationMs: 0 },
              {
                type: "tool_call",
                name: "AskUserQuestion",
                input: { questions: [{ question: "Which?", header: "H", options: [{ label: "A" }], multiSelect: true }] },
              },
              { type: "tool_call", name: "request_user_input", input: { questions: [{ question: "Name?" }] } },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(cfg.scenarios[0].responses[0].parts.length, 5);
});

test("parseDemoConfig reports every problem with its path", () => {
  expectInvalid({}, "scenarios");
  expectInvalid({ scenarios: [] }, "scenarios");
  expectInvalid({ scenarios: [{ name: "x", firstMessage: "x", responses: [] }] }, "scenarios[0].responses");
  expectInvalid({ scenarios: [{ name: "x", firstMessage: "  ", responses: [{ parts: [{ type: "text", text: "" }] }] }] }, "scenarios[0].firstMessage");
  expectInvalid(
    { scenarios: [{ name: "x", firstMessage: "x", responses: [{ parts: [{ type: "image" }] }] }] },
    "scenarios[0].responses[0].parts[0].type",
  );
  expectInvalid(
    { scenarios: [{ name: "x", firstMessage: "x", responses: [{ parts: [{ type: "tool_call", name: "Read", kind: "nope" }] }] }] },
    "parts[0].kind",
  );
  // Typos in keys are caught rather than silently ignored.
  expectInvalid({ scenarios: [{ name: "x", firstMesage: "x", responses: [] }] }, "firstMesage");
  expectInvalid({ timing: { textDelay: 1 }, scenarios: [scenario("x")] }, "timing", "textDelay");
});

test("parseDemoConfig requires questions for ask-user tools and rejects scripted results", () => {
  const withPart = (part: unknown) => ({ scenarios: [{ name: "q", firstMessage: "q", responses: [{ parts: [part] }] }] });
  expectInvalid(withPart({ type: "tool_call", name: "AskUserQuestion" }), "parts[0].input", "needs input.questions");
  expectInvalid(withPart({ type: "tool_call", name: "AskUserQuestion", input: { questions: [] } }), "input.questions");
  expectInvalid(
    withPart({ type: "tool_call", name: "AskUserQuestion", input: { questions: [{ question: "q", options: [{ label: "a" }, { label: "a" }] }] } }),
    'duplicate option label "a"',
  );
  expectInvalid(
    withPart({ type: "tool_call", name: "AskUserQuestion", input: { questions: [{ question: "q", multiSelect: true }] } }),
    "multiSelect",
  );
  expectInvalid(
    withPart({ type: "tool_call", name: "AskUserQuestion", input: { questions: [{ question: "q" }] }, output: "x" }),
    "answered by the user",
  );
});

test("parseDemoConfig rejects scenarios whose firstMessage collide after normalization", () => {
  expectInvalid({ scenarios: [scenario("Hello  world", "a"), scenario(" hello WORLD ", "b")] }, "scenarios[1].firstMessage", '"a"');
});

test("findScenario matches the first message case- and whitespace-insensitively", () => {
  const cfg = parseDemoConfig({ scenarios: [scenario("Ask me a question", "q"), scenario("hello", "h")] });
  assert.equal(findScenario(cfg, "ask me a question")?.name, "q");
  assert.equal(findScenario(cfg, "  ASK   me a\nquestion ")?.name, "q");
  assert.equal(findScenario(cfg, "hello")?.name, "h");
  assert.equal(findScenario(cfg, "hello there"), null);
  assert.equal(findScenario(cfg, ""), null);
});

test("isAskUserToolName recognizes Claude and Codex spellings", () => {
  for (const n of ["AskUserQuestion", "ask_user_question", "request_user_input", "RequestUserInput"]) {
    assert.equal(isAskUserToolName(n), true, n);
  }
  for (const n of ["Read", "Bash", "question"]) assert.equal(isAskUserToolName(n), false, n);
});

test("loadDemoConfig reports unreadable and malformed files with their path", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jb-demo-cfg-"));
  try {
    const missing = path.join(dir, "missing.json");
    await assert.rejects(loadDemoConfig(missing), (err: Error) => err.message.includes(missing));
    const bad = path.join(dir, "bad.json");
    await fs.writeFile(bad, "{ nope", "utf8");
    await assert.rejects(loadDemoConfig(bad), /not valid JSON/);
    const invalid = path.join(dir, "invalid.json");
    await fs.writeFile(invalid, JSON.stringify({ scenarios: [] }), "utf8");
    await assert.rejects(loadDemoConfig(invalid), (err: Error) => err.message.includes(invalid));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
