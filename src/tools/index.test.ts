import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "./index";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function mkWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-tools-"));
}

test("createToolRegistry returns map containing read_file and write_file", async () => {
  const ws = await mkWorkspace();
  try {
    const reg = createToolRegistry(ws);
    assert.ok(reg instanceof Map);
    assert.ok(reg.has("read_file"));
    assert.ok(reg.has("write_file"));
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("write_file creates parent dirs and writes UTF-8 content", async () => {
  const ws = await mkWorkspace();
  try {
    const reg = createToolRegistry(ws);
    const write = reg.get("write_file")!;
    await write({ path: "a/b/c.txt", content: "hello\nworld" });
    const onDisk = await fs.readFile(path.join(ws, "a", "b", "c.txt"), "utf8");
    assert.equal(onDisk, "hello\nworld");
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("read_file returns contents for a file inside the workspace", async () => {
  const ws = await mkWorkspace();
  try {
    await fs.writeFile(path.join(ws, "greet.txt"), "hi there", "utf8");
    const reg = createToolRegistry(ws);
    const read = reg.get("read_file")!;
    const out = await read({ path: "greet.txt" });
    assert.equal(out, "hi there");
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("read_file throws Path outside workspace for ../escape", async () => {
  const ws = await mkWorkspace();
  try {
    const reg = createToolRegistry(ws);
    const read = reg.get("read_file")!;
    await assert.rejects(
      () => read({ path: "../escape.txt" }),
      (err: unknown) =>
        err instanceof Error &&
        /Path outside workspace/.test(err.message) &&
        err.message.includes("../escape.txt"),
    );
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("write_file throws Path outside workspace for absolute escape", async () => {
  const ws = await mkWorkspace();
  try {
    const reg = createToolRegistry(ws);
    const write = reg.get("write_file")!;
    await assert.rejects(
      () => write({ path: "/etc/hosts", content: "pwned" }),
      (err: unknown) =>
        err instanceof Error && /Path outside workspace/.test(err.message),
    );
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("write_file rejects symlink that escapes the workspace", async () => {
  const ws = await mkWorkspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-outside-"));
  try {
    const linkPath = path.join(ws, "link.txt");
    await fs.symlink(path.join(outside, "secret"), linkPath);
    const reg = createToolRegistry(ws);
    const write = reg.get("write_file")!;
    await assert.rejects(
      () => write({ path: "link.txt", content: "pwned" }),
      (err: unknown) =>
        err instanceof Error && /Path outside workspace/.test(err.message),
    );
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("read_file rejects unknown params shape (Zod)", async () => {
  const ws = await mkWorkspace();
  try {
    const reg = createToolRegistry(ws);
    const read = reg.get("read_file")!;
    await assert.rejects(
      () => read({} as unknown),
      (err: unknown) => err instanceof Error,
    );
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});
