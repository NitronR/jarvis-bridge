// Build the ACP prompt block array (text + images) and enforce the
// transport's per-message byte budget.

import type { PromptImageAttachment } from "../types.js";
import { fitImageToBudget, canDecodeImage } from "./image-resize";

export type AcpPromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type SkippedImageReason = "too-large" | "unsupported" | "decode-error";

export interface SkippedImage {
  filename?: string;
  mimeType: string;
  reason: SkippedImageReason;
}

export interface BuildAcpPromptOptions {
  // Suggested defaults (calibrate to your target agent):
  singleImageBudgetBytes?: number;
  wholePromptBudgetBytes?: number;
}

export type BuildAcpPromptResult =
  | { ok: true; blocks: AcpPromptBlock[]; skipped: SkippedImage[] }
  | { ok: false; error: string; skipped: SkippedImage[] };

const DEFAULT_SINGLE_IMAGE_BUDGET = 140 * 1024;
const DEFAULT_WHOLE_PROMPT_BUDGET = 150 * 1024;
const MIN_PER_IMAGE_BUDGET = 8 * 1024;
const JSON_OVERHEAD_BYTES = 256;

function approxTextBlockBytes(text: string): number {
  // Each char in the prompt's text block base64-expands ~1.33× plus
  // ~256 B of JSON wrapping. We measure the final size pre-flight anyway,
  // so this is just a coarse pre-allocation.
  return Math.ceil((text.length * 4) / 3) + JSON_OVERHEAD_BYTES;
}

function base64ByteLength(b64: string): number {
  return Math.ceil(b64.length / 4) * 3;
}

export function buildAcpPrompt(
  text: string,
  images: PromptImageAttachment[],
  options: BuildAcpPromptOptions = {},
): BuildAcpPromptResult {
  const skipped: SkippedImage[] = [];
  const singleBudget = options.singleImageBudgetBytes ?? DEFAULT_SINGLE_IMAGE_BUDGET;
  const totalBudget = options.wholePromptBudgetBytes ?? DEFAULT_WHOLE_PROMPT_BUDGET;

  const blocks: AcpPromptBlock[] = [];

  // ACP needs ≥1 block. For image-only turns, omit the empty text block.
  if (text.length > 0) {
    blocks.push({ type: "text", text });
  }

  if (images.length > 0) {
    // Per-image budget: one image gets the whole single-image budget;
    // multiple images share the total budget minus text + JSON overhead.
    const textOverhead = text.length > 0 ? approxTextBlockBytes(text) : 0;
    const availableForImages = Math.max(0, totalBudget - textOverhead);
    let perImageBudget: number;
    if (images.length === 1) {
      perImageBudget = singleBudget;
    } else {
      const reserved = images.length * JSON_OVERHEAD_BYTES;
      const remainder = Math.max(0, availableForImages - reserved);
      perImageBudget = Math.max(
        MIN_PER_IMAGE_BUDGET,
        Math.min(singleBudget, Math.floor(remainder / images.length)),
      );
    }

    for (const img of images) {
      const decoded = Buffer.from(img.data, "base64");

      // For resizable mimes, validate by attempting to decode. Bad bytes are
      // a decode-error regardless of size.
      if (img.mimeType === "image/png" || img.mimeType === "image/jpeg") {
        if (!canDecodeImage(decoded, img.mimeType)) {
          skipped.push({
            filename: img.filename,
            mimeType: img.mimeType,
            reason: "decode-error",
          });
          continue;
        }
      }

      const originalBytes = base64ByteLength(img.data);
      if (originalBytes <= perImageBudget) {
        // Already fits; pass through unchanged.
        blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
        continue;
      }
      // Try to resize.
      const fitted = fitImageToBudget(decoded, img.mimeType, perImageBudget);
      if (fitted) {
        blocks.push({
          type: "image",
          data: fitted.toString("base64"),
          mimeType: "image/jpeg",
        });
      } else {
        const reason: SkippedImageReason =
          img.mimeType === "image/png" || img.mimeType === "image/jpeg"
            ? "too-large"
            : "unsupported";
        skipped.push({ filename: img.filename, mimeType: img.mimeType, reason });
      }
    }
  }

  // Pre-flight total guard: serialize and measure.
  const totalJsonBytes = Buffer.byteLength(JSON.stringify(blocks), "utf8");
  if (totalJsonBytes > totalBudget) {
    return {
      ok: false,
      error: `prompt payload ${totalJsonBytes} B exceeds total budget ${totalBudget} B`,
      skipped,
    };
  }

  return { ok: true, blocks, skipped };
}