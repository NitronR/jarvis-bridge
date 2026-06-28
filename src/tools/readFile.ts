// Workspace-scoped file read tool. Factory closes over the workspace
// root (realpath-resolved at construction) so the path-traversal guard
// always runs against the same trusted root.

import fs from "node:fs/promises";
import path from "node:path";
import { ReadFileParamsSchema, type ToolHandler } from "../types";
import { assertInWorkspace, realpathExistingOrSymlink } from "./pathGuard";

export function createReadFileTool(workspaceReal: string): ToolHandler {
  return async (params: unknown) => {
    const parsed = ReadFileParamsSchema.parse(params);
    const resolved = path.resolve(workspaceReal, parsed.path);
    const { real } = await realpathExistingOrSymlink(resolved);
    await assertInWorkspace(workspaceReal, real, parsed.path);
    return await fs.readFile(real, { encoding: parsed.encoding ?? "utf-8" });
  };
}
