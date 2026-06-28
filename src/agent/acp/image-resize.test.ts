import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { base64EncodedLength, fitImageToBudget } from "./image-resize";

describe("base64EncodedLength", () => {
  test("0 bytes -> 0 chars", () => {
    assert.equal(base64EncodedLength(0), 0);
  });
  test("1 byte -> 4 chars", () => {
    assert.equal(base64EncodedLength(1), 4);
  });
  test("3 bytes -> 4 chars", () => {
    assert.equal(base64EncodedLength(3), 4);
  });
  test("4 bytes -> 8 chars", () => {
    assert.equal(base64EncodedLength(4), 8);
  });
  test("exact expansion (ceil(n/3)*4)", () => {
    assert.equal(base64EncodedLength(7), 12);
    assert.equal(base64EncodedLength(9), 12);
    assert.equal(base64EncodedLength(10), 16);
  });
});

describe("fitImageToBudget", () => {
  test("returns input unchanged when it already fits", () => {
    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // valid empty-ish JPEG-ish
    const out = fitImageToBudget(tiny, "image/jpeg", 1024);
    assert.ok(out);
    assert.equal(out!.length, tiny.length);
  });

  test("non-resizable mime that already fits is returned unchanged", () => {
    const tiny = Buffer.from("GIF89a");
    const out = fitImageToBudget(tiny, "image/gif", 1024);
    assert.ok(out);
    assert.equal(out!.length, tiny.length);
  });

  test("non-resizable mime that does NOT fit returns null", () => {
    const big = Buffer.alloc(2048, 1);
    const out = fitImageToBudget(big, "image/webp", 1024);
    assert.equal(out, null);
  });

  test("invalid JPEG bytes returns null", () => {
    const bad = Buffer.alloc(4096, 0xaa);
    const out = fitImageToBudget(bad, "image/jpeg", 1024);
    assert.equal(out, null);
  });

  test("downsizes a noisy PNG that does not fit, producing a JPEG", () => {
    // Build a 1024×1024 PNG with a noisy (incompressible) checkerboard.
    const pngModule = require("pngjs") as typeof import("pngjs");
    const png = new pngModule.PNG({ width: 1024, height: 1024 });
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        const idx = (y * 1024 + x) << 2;
        // Pseudo-random noise — incompressible.
        const v = ((x * 31 + y * 17) ^ (x << 3) ^ (y << 5)) & 0xff;
        png.data[idx] = v;
        png.data[idx + 1] = v ^ 0x55;
        png.data[idx + 2] = v ^ 0xaa;
        png.data[idx + 3] = 255;
      }
    }
    const original = pngModule.PNG.sync.write(png);
    assert.ok(
      original.length > 4 * 1024,
      `noisy PNG should be > 4 KB; got ${original.length}`,
    );
    const targetBudget = 32 * 1024; // 32 KB base64 chars (~24 KB raw)
    const out = fitImageToBudget(original, "image/png", targetBudget);
    assert.ok(out, "should produce a resized result");
    // Result must be a JPEG (re-encoded).
    assert.equal(out![0], 0xff);
    assert.equal(out![1], 0xd8);
    const encoded = out!.toString("base64");
    assert.ok(
      encoded.length <= targetBudget,
      `encoded ${encoded.length} chars should be <= budget ${targetBudget} chars`,
    );
  });
});