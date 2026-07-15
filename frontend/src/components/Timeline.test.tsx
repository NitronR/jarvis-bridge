import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Timeline } from "./Timeline";
import type { ChatPatch } from "../api/types";

describe("<Timeline>", () => {
  it("renders text-start as a markdown bubble", () => {
    const { container } = render(
      <Timeline patches={[
        { type: "text-start", index: 0, content: "hello" },
        { type: "text-delta", index: 0, delta: " world" },
      ]} />,
    );
    expect(container.textContent).toContain("hello world");
  });

  it("renders a tool call card with args and return", () => {
    const { container } = render(
      <Timeline patches={[
        { type: "tool-call-start", index: 0, toolCallId: "tc-1", toolName: "bash", argsInitial: "" },
        { type: "tool-call-finalized", index: 0, toolCallId: "tc-1", args: { command: "ls" } },
        { type: "tool-return", toolCallId: "tc-1", content: "file.txt\n" },
      ]} />,
    );
    expect(container.textContent).toContain("bash");
    expect(container.textContent).toContain("ls");
    expect(container.textContent).toContain("file.txt");
  });

  it("renders a thought block", () => {
    const { container } = render(<Timeline patches={[{ type: "thought-start", index: 0, content: "thinking…" }]} />);
    expect(container.textContent).toContain("thinking…");
  });

  it("renders an error", () => {
    const { container } = render(<Timeline patches={[{ type: "error", message: "boom" }]} />);
    expect(container.textContent).toContain("boom");
  });

  it("renders usage as token pills", () => {
    const { container } = render(
      <Timeline patches={[{
        type: "usage",
        usage: { requests: 1, input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 },
      }]} />,
    );
    expect(container.textContent).toMatch(/in\s+10/);
    expect(container.textContent).toMatch(/out\s+20/);
  });

  it("emits approval-request via callback", () => {
    let received: ChatPatch | null = null;
    render(
      <Timeline
        patches={[{
          type: "approval-request",
          requestId: "r1",
          toolCallId: "tc-1",
          toolName: "bash",
          options: [{ id: "allow_once", name: "Allow once" }],
        }]}
        onApproval={(p) => (received = p)}
      />,
    );
    expect(received).not.toBeNull();
    expect((received as unknown as ChatPatch & { requestId: string }).requestId).toBe("r1");
  });

  it("emits elicitation-request via callback", () => {
    let received: ChatPatch | null = null;
    render(
      <Timeline
        patches={[{
          type: "elicitation-request",
          requestId: "e1",
          toolCallId: "tc-1",
          message: "Pick one",
          fields: [{ key: "question_0", kind: "select", options: [{ value: "a", label: "A" }] }],
        }]}
        onElicitation={(p) => (received = p)}
      />,
    );
    expect(received).not.toBeNull();
    expect((received as unknown as ChatPatch & { requestId: string }).requestId).toBe("e1");
  });

  it("does not re-emit elicitation-request when later patches stream in after resolution", () => {
    let calls = 0;
    const elicitation: ChatPatch = {
      type: "elicitation-request",
      requestId: "e1",
      toolCallId: "tc-1",
      message: "Pick one",
      fields: [{ key: "question_0", kind: "select", options: [{ value: "a", label: "A" }] }],
    };
    const { rerender } = render(
      <Timeline patches={[elicitation]} onElicitation={() => calls++} />,
    );
    expect(calls).toBe(1);
    // Simulate the turn continuing after the user answered: more patches get
    // appended to the same (still-growing) array, as happens mid-stream.
    rerender(
      <Timeline
        patches={[elicitation, { type: "text-start", index: 0, content: "thanks!" }]}
        onElicitation={() => calls++}
      />,
    );
    rerender(
      <Timeline
        patches={[elicitation, { type: "text-start", index: 0, content: "thanks!" }, { type: "text-delta", index: 0, delta: " more" }]}
        onElicitation={() => calls++}
      />,
    );
    expect(calls).toBe(1);
  });

  it("does not re-emit approval-request when later patches stream in after resolution", () => {
    let calls = 0;
    const approval: ChatPatch = {
      type: "approval-request",
      requestId: "r1",
      toolCallId: "tc-1",
      toolName: "bash",
      options: [{ id: "allow_once", name: "Allow once" }],
    };
    const { rerender } = render(<Timeline patches={[approval]} onApproval={() => calls++} />);
    expect(calls).toBe(1);
    rerender(
      <Timeline
        patches={[approval, { type: "tool-return", toolCallId: "tc-1", content: "ok" }]}
        onApproval={() => calls++}
      />,
    );
    expect(calls).toBe(1);
  });
});
