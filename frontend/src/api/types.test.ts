import { describe, it, expect } from "vitest";
import type { ChatPatch } from "./types";

describe("ChatPatch type", () => {
  it("narrows text-start correctly", () => {
    const p: ChatPatch = { type: "text-start", index: 0, content: "hi" };
    if (p.type === "text-start") {
      expect(p.content).toBe("hi");
    } else {
      throw new Error("not text-start");
    }
  });
  it("narrows tool-call-start correctly", () => {
    const p: ChatPatch = {
      type: "tool-call-start",
      index: 1,
      toolCallId: "tc-1",
      toolName: "bash",
      argsInitial: "ls",
    };
    expect(p.toolName).toBe("bash");
  });
  it("narrows approval-request correctly", () => {
    const p: ChatPatch = {
      type: "approval-request",
      requestId: "r1",
      toolCallId: "tc-1",
      toolName: "bash",
      options: [{ id: "allow_once", name: "Allow once" }],
    };
    expect(p.options[0].id).toBe("allow_once");
  });
});