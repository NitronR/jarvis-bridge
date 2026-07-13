import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChooseFolderScript } from "./pickFolder";

test("buildChooseFolderScript with no initialCwd", () => {
  const script = buildChooseFolderScript();
  assert.equal(
    script,
    'POSIX path of (choose folder with prompt "Select a workspace folder")',
  );
});

test("buildChooseFolderScript escapes quotes and backslashes in initialCwd", () => {
  const script = buildChooseFolderScript('/Users/bob/weird"path\\here');
  assert.equal(
    script,
    'POSIX path of (choose folder with prompt "Select a workspace folder" default location (POSIX file "/Users/bob/weird\\"path\\\\here"))',
  );
});
