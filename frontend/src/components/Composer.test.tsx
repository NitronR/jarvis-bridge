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
});
