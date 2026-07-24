import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";
import { saveQuickPhrases, loadQuickPhrases } from "../state/quickPhrases";
import type { ImageAttachment } from "../api/types";

const noopAsync = async () => {};

const baseProps = {
  busy: false,
  steerEnabled: false,
  steerSupported: true,
  imagesSupported: true,
  attachments: [] as ImageAttachment[],
  models: [] as { modelId: string; name: string }[],
  currentModel: null as string | null,
  onModelChange: vi.fn(),
  autoApproveEffective: false,
  autoApproveCapable: true,
  onAutoApproveToggle: vi.fn(),
  onRemoveAttachment: vi.fn(),
  onAttachFiles: vi.fn(),
  onSend: vi.fn(),
  onSteer: noopAsync,
  onCancel: noopAsync,
  onQueue: noopAsync,
  onToggleSteer: vi.fn(),
};

describe("<Composer>", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("submits with the trimmed text", () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(textarea, { target: { value: "  hi  " } });
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("shows the cancel button while busy", () => {
    render(<Composer {...baseProps} busy={true} />);
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("calls onCancel when stop is clicked", () => {
    const onCancel = vi.fn();
    render(<Composer {...baseProps} busy={true} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Stop"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders image attachments with remove buttons", () => {
    const onRemove = vi.fn();
    const attachments: ImageAttachment[] = [{ data: "abc", mimeType: "image/png", filename: "a.png" }];
    render(<Composer {...baseProps} attachments={attachments} onRemoveAttachment={onRemove} />);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    fireEvent.click(screen.getByText("×"));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("attaches dropped image files", () => {
    const onAttachFiles = vi.fn();
    render(<Composer {...baseProps} onAttachFiles={onAttachFiles} />);
    const form = screen.getByPlaceholderText(/type a message/i).closest("form")!;
    const imageFile = new File(["data"], "photo.png", { type: "image/png" });
    const textFile = new File(["data"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(form, { dataTransfer: { files: [imageFile, textFile], types: ["Files"] } });
    expect(onAttachFiles).toHaveBeenCalledWith([imageFile]);
  });

  it("does not attach dropped files when images are unsupported", () => {
    const onAttachFiles = vi.fn();
    render(<Composer {...baseProps} imagesSupported={false} onAttachFiles={onAttachFiles} />);
    const form = screen.getByPlaceholderText(/type a message/i).closest("form")!;
    const imageFile = new File(["data"], "photo.png", { type: "image/png" });
    fireEvent.drop(form, { dataTransfer: { files: [imageFile], types: ["Files"] } });
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it("renders no quick-phrase pills when none are saved", () => {
    render(<Composer {...baseProps} />);
    expect(screen.queryByRole("button", { name: "run the tests" })).not.toBeInTheDocument();
  });

  it("sends a quick phrase as a message when its pill is clicked", () => {
    const onSend = vi.fn();
    saveQuickPhrases(["run the tests", "ping me when done"]);
    render(<Composer {...baseProps} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "run the tests" }));
    expect(onSend).toHaveBeenCalledWith("run the tests");
  });

  it("leaves the composer's own draft text untouched when a quick phrase is submitted", () => {
    saveQuickPhrases(["please"]);
    render(<Composer {...baseProps} />);
    const textarea = screen.getByPlaceholderText(/type a message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "run the tests" } });
    fireEvent.click(screen.getByRole("button", { name: "please" }));
    expect(textarea.value).toBe("run the tests");
  });

  it("queues a quick phrase instead of sending it while busy", () => {
    const onQueue = vi.fn();
    saveQuickPhrases(["run the tests"]);
    render(<Composer {...baseProps} busy={true} onQueue={onQueue} />);
    fireEvent.click(screen.getByRole("button", { name: "run the tests" }));
    expect(onQueue).toHaveBeenCalledWith("run the tests");
  });

  it("clears the textarea after clicking Queue, matching the Enter-to-queue path", () => {
    const onQueue = vi.fn();
    render(<Composer {...baseProps} busy={true} onQueue={onQueue} />);
    const textarea = screen.getByPlaceholderText(/queue a message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "run the tests" } });
    fireEvent.click(screen.getByText("Queue"));
    expect(onQueue).toHaveBeenCalledWith("run the tests");
    expect(textarea.value).toBe("");
  });

  it("steers with a quick phrase instead of sending it while steering", () => {
    const onSteer = vi.fn();
    saveQuickPhrases(["run the tests"]);
    render(<Composer {...baseProps} steerEnabled={true} onSteer={onSteer} />);
    fireEvent.click(screen.getByRole("button", { name: "run the tests" }));
    expect(onSteer).toHaveBeenCalledWith("run the tests");
  });

  it("adds a new quick phrase via the + button and persists it", () => {
    render(<Composer {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Add quick phrase" }));
    const input = screen.getByPlaceholderText(/new quick phrase/i);
    fireEvent.change(input, { target: { value: "new phrase" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "new phrase" })).toBeInTheDocument();
    expect(loadQuickPhrases()).toEqual(["new phrase"]);
  });

  it("removes a quick-phrase pill when its delete cross is clicked, without submitting it", () => {
    saveQuickPhrases(["run the tests", "ping me when done"]);
    render(<Composer {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove quick phrase: run the tests" }));
    expect(screen.queryByRole("button", { name: "run the tests" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ping me when done" })).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/type a message/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  describe("empty-input handling", () => {
    it("disables Send when the composer is empty", () => {
      render(<Composer {...baseProps} />);
      expect(screen.getByText("Send")).toBeDisabled();
    });

    it("enables Send once there is text", () => {
      render(<Composer {...baseProps} />);
      const textarea = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(textarea, { target: { value: "hi" } });
      expect(screen.getByText("Send")).toBeEnabled();
    });

    it("enables Send when there are attachments even with empty text", () => {
      const attachments: ImageAttachment[] = [{ data: "abc", mimeType: "image/png", filename: "a.png" }];
      render(<Composer {...baseProps} attachments={attachments} />);
      expect(screen.getByText("Send")).toBeEnabled();
    });

    it("enables Queue (not just Send) when there are attachments even with empty text, while busy", () => {
      const attachments: ImageAttachment[] = [{ data: "abc", mimeType: "image/png", filename: "a.png" }];
      render(<Composer {...baseProps} busy={true} attachments={attachments} />);
      expect(screen.getByText("Queue")).toBeEnabled();
    });
  });

  describe("textarea auto-resize", () => {
    it("grows the textarea height with content, capped at the 4-line max", () => {
      render(<Composer {...baseProps} />);
      const textarea = screen.getByPlaceholderText(/type a message/i) as HTMLTextAreaElement;

      Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 60 });
      fireEvent.change(textarea, { target: { value: "line1\nline2" } });
      expect(textarea.style.height).toBe("60px");

      Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 300 });
      fireEvent.change(textarea, { target: { value: "line1\nline2\nline3\nline4\nline5" } });
      expect(textarea.style.height).toBe("96px");
    });
  });

  describe("attach button", () => {
    it("has an accessible name via aria-label", () => {
      render(<Composer {...baseProps} />);
      expect(screen.getByRole("button", { name: "Attach image" })).toBeInTheDocument();
    });
  });

  describe("model selector", () => {
    const models = [
      { modelId: "m1", name: "Model One" },
      { modelId: "m2", name: "Model Two" },
    ];

    it("shows the current model name on the trigger button", () => {
      render(<Composer {...baseProps} models={models} currentModel="m2" />);
      expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent("Model Two");
    });

    it("opens the dropdown and calls onModelChange when an option is clicked", async () => {
      const onModelChange = vi.fn();
      render(<Composer {...baseProps} models={models} currentModel="m1" onModelChange={onModelChange} />);
      fireEvent.click(screen.getByRole("button", { name: "Model" }));
      expect(screen.getByRole("option", { name: "Model Two" })).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByRole("option", { name: "Model Two" }));
      expect(onModelChange).toHaveBeenCalledWith("m2");
    });

    it("disables the selector when there are no models", () => {
      render(<Composer {...baseProps} models={[]} />);
      expect(screen.getByRole("button", { name: "Model" })).toBeDisabled();
    });
  });

  describe("auto-approve toggle", () => {
    it("shows Auto-approve and calls onAutoApproveToggle when clicked", () => {
      const onAutoApproveToggle = vi.fn();
      render(<Composer {...baseProps} onAutoApproveToggle={onAutoApproveToggle} />);
      fireEvent.click(screen.getByRole("switch", { name: "Auto-approve" }));
      expect(onAutoApproveToggle).toHaveBeenCalled();
    });

    it("reflects the effective state via aria-checked", () => {
      render(<Composer {...baseProps} autoApproveEffective={true} />);
      expect(screen.getByRole("switch", { name: "Auto-approve" })).toBeChecked();
    });

    it("is unchecked when not effective", () => {
      render(<Composer {...baseProps} autoApproveEffective={false} />);
      expect(screen.getByRole("switch", { name: "Auto-approve" })).not.toBeChecked();
    });

    it("is disabled when not capable", () => {
      render(<Composer {...baseProps} autoApproveCapable={false} />);
      expect(screen.getByRole("switch", { name: "Auto-approve" })).toBeDisabled();
    });
  });

  describe("Steer visibility", () => {
    it("does not render Steer while idle, even when steerSupported", () => {
      render(<Composer {...baseProps} busy={false} steerSupported={true} />);
      expect(screen.queryByText("Steer")).not.toBeInTheDocument();
    });

    it("renders Steer while busy, when steerSupported", () => {
      render(<Composer {...baseProps} busy={true} steerSupported={true} />);
      expect(screen.getByText("Steer")).toBeInTheDocument();
    });

    it("does not render Steer while busy when steerSupported is false", () => {
      render(<Composer {...baseProps} busy={true} steerSupported={false} />);
      expect(screen.queryByText("Steer")).not.toBeInTheDocument();
    });
  });

  describe("context warning", () => {
    it("adds a non-color warning glyph once usage exceeds 80%", () => {
      render(
        <Composer
          {...baseProps}
          latestUsage={{
            requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
            context_limit: 1000, context_used: 900,
          }}
        />,
      );
      expect(screen.getByText(/⚠/)).toBeInTheDocument();
    });

    it("shows no warning glyph under 80% usage", () => {
      render(
        <Composer
          {...baseProps}
          latestUsage={{
            requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
            context_limit: 1000, context_used: 100,
          }}
        />,
      );
      expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
    });
  });
});
