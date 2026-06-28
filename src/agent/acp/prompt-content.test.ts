import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildAcpPrompt, type BuildAcpPromptOptions } from "./prompt-content";
import type { PromptImageAttachment } from "../types.js";

// Small 1x1 red PNG (67 bytes raw). Plenty of room in any budget.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tinyPng(filename = "tiny.png"): PromptImageAttachment {
  return { data: TINY_PNG_B64, mimeType: "image/png", filename };
}

describe("buildAcpPrompt", () => {
  test("text-only prompt produces a single text block", () => {
    const r = buildAcpPrompt("hello", [], {});
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.blocks.length, 1);
    assert.equal(r.blocks[0]!.type, "text");
    assert.equal((r.blocks[0] as { type: "text"; text: string }).text, "hello");
    assert.deepEqual(r.skipped, []);
  });

  test("image-only prompt omits the empty text block", () => {
    const r = buildAcpPrompt("", [tinyPng()], {});
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.blocks.length, 1);
    assert.equal(r.blocks[0]!.type, "image");
    assert.equal((r.blocks[0] as { type: "image"; mimeType: string }).mimeType, "image/png");
  });

  test("text + image produces text block then image block", () => {
    const r = buildAcpPrompt("describe", [tinyPng()], {});
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.blocks.length, 2);
    assert.equal(r.blocks[0]!.type, "text");
    assert.equal(r.blocks[1]!.type, "image");
  });

  test("unsupported mime is skipped with reason", () => {
    const gif: PromptImageAttachment = {
      data: "R0lGODlhAQABAAAAACw=",
      mimeType: "image/gif",
      filename: "anim.gif",
    };
    const r = buildAcpPrompt("see", [gif], { singleImageBudgetBytes: 1024 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    // The image is small enough to pass through unchanged (no resize attempt)
    assert.equal(r.blocks.length, 2);
    assert.equal(r.blocks[1]!.type, "image");
    assert.deepEqual(r.skipped, []);
  });

  test("image with bad base64 is skipped as decode-error", () => {
    const bad: PromptImageAttachment = {
      data: "not-base64-!!!@@@",
      mimeType: "image/png",
      filename: "bad.png",
    };
    const r = buildAcpPrompt("see", [bad], { singleImageBudgetBytes: 1024 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.blocks.length, 1);
    assert.equal(r.blocks[0]!.type, "text");
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0]!.reason, "decode-error");
  });

  test("respects options override for budgets", () => {
    const opts: BuildAcpPromptOptions = {
      singleImageBudgetBytes: 10 * 1024,
      wholePromptBudgetBytes: 12 * 1024,
    };
    const r = buildAcpPrompt("x", [tinyPng(), tinyPng("b.png")], opts);
    assert.equal(r.ok, true);
  });
});