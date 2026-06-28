// Workspace-scoped file write tool. Factory closes over the workspace
// root (realpath-resolved at construction). For writes the target file
// may not exist yet, so we resolve any existing symlink and walk up to
// a real existing ancestor.

import fs from "node:fs/promises";
import path from "node:path";
import { WriteFileParamsSchema, type ToolHandler } from "../types";
import { assertInWorkspace, realpathExistingOrSymlink } from "./pathGuard";

export function createWriteFileTool(workspaceReal: string): ToolHandler {
  return async (params: unknown) => {
    const parsed = WriteFileParamsSchema.parse(params);
    const resolved = path.resolve(workspaceReal, parsed.path);
    const { real } = await realpathExistingOrSymlink(resolved);
    await assertInWorkspace(workspaceReal, real, parsed.path);
    const realParent = path.dirname(real);
    await fs.mkdir(realParent, { recursive: true });
    await fs.writeFile(real, parsed.content, { encoding: "utf-8" });
  };
}
