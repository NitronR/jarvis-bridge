// Downscale images so their base64 payload fits a byte budget.
// Pure-JS codecs (jpeg-js, pngjs) — no native dependencies.

import * as jpeg from "jpeg-js";
import { PNG } from "pngjs";

export function base64EncodedLength(byteLen: number): number {
  return Math.ceil(byteLen / 3) * 4;
}

const RESIZABLE_MIMES = new Set(["image/png", "image/jpeg"]);
const LONG_EDGE_CAPS = [1568, 1280, 1024, 768, 512, 384, 256] as const;
const JPEG_QUALITIES = [80, 65, 50, 35] as const;

interface RawRgba {
  width: number;
  height: number;
  data: Buffer;
}

export function canDecodeImage(bytes: Buffer, mimeType: string): boolean {
  return decodeImage(bytes, mimeType) !== null;
}

function decodeImage(bytes: Buffer, mimeType: string): RawRgba | null {
  try {
    if (mimeType === "image/png") {
      const png = PNG.sync.read(bytes);
      return { width: png.width, height: png.height, data: png.data };
    }
    if (mimeType === "image/jpeg") {
      const decoded = jpeg.decode(bytes, { useTArray: false, formatAsRGBA: true });
      return {
        width: decoded.width,
        height: decoded.height,
        data: decoded.data as Buffer,
      };
    }
  } catch {
    return null;
  }
  return null;
}

// Box-filter downscale: averages src pixels into each dst pixel.
// Avoids nearest-neighbor aliasing. Downscale-only — never upscales.
function downscale(src: RawRgba, longestEdge: number): RawRgba {
  const longest = Math.max(src.width, src.height);
  if (longest <= longestEdge) return src;
  const scale = longestEdge / longest;
  const dstW = Math.max(1, Math.round(src.width * scale));
  const dstH = Math.max(1, Math.round(src.height * scale));
  const dst = Buffer.alloc(dstW * dstH * 4);
  const xRatio = src.width / dstW;
  const yRatio = src.height / dstH;

  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor(y * yRatio);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor(x * xRatio);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * xRatio));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const si = (sy * src.width + sx) << 2;
          r += src.data[si]!;
          g += src.data[si + 1]!;
          b += src.data[si + 2]!;
          a += src.data[si + 3]!;
          n++;
        }
      }
      const di = (y * dstW + x) << 2;
      dst[di] = Math.round(r / n);
      dst[di + 1] = Math.round(g / n);
      dst[di + 2] = Math.round(b / n);
      dst[di + 3] = Math.round(a / n);
    }
  }
  return { width: dstW, height: dstH, data: dst };
}

function encodeJpeg(img: RawRgba, quality: number): Buffer | null {
  try {
    const result = jpeg.encode(
      { width: img.width, height: img.height, data: img.data },
      quality,
    );
    return result.data;
  } catch {
    return null;
  }
}

function fitsBudget(buf: Buffer, maxEncodedBytes: number): boolean {
  return base64EncodedLength(buf.length) <= maxEncodedBytes;
}

export function fitImageToBudget(
  bytes: Buffer,
  mimeType: string,
  maxEncodedBytes: number,
): Buffer | null {
  // Original already fits — return as-is.
  if (fitsBudget(bytes, maxEncodedBytes)) return bytes;

  // Non-resizable mime that doesn't fit — caller will skip it.
  if (!RESIZABLE_MIMES.has(mimeType)) return null;

  const decoded = decodeImage(bytes, mimeType);
  if (!decoded) return null;

  // Iterate (longest edge × quality); return first JPEG whose base64 fits.
  for (const cap of LONG_EDGE_CAPS) {
    const scaled = downscale(decoded, cap);
    for (const quality of JPEG_QUALITIES) {
      const encoded = encodeJpeg(scaled, quality);
      if (!encoded) continue;
      if (fitsBudget(encoded, maxEncodedBytes)) return encoded;
    }
  }
  return null;
}