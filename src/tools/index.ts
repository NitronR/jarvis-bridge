// Workspace-scoped tool registry. Each tool is a factory that captures
// the realpath-resolved workspace root via closure; that way every
// symlink-escape check happens against the same trusted root.

import type { ToolHandler } from "../types";
import { realpathExistingSync } from "./pathGuard";
import { createReadFileTool } from "./readFile";
import { createWriteFileTool } from "./writeFile";

export function createToolRegistry(workspace: string): Map<string, ToolHandler> {
  const real = realpathExistingSync(workspace);
  const reg = new Map<string, ToolHandler>();
  reg.set("read_file", createReadFileTool(real));
  reg.set("write_file", createWriteFileTool(real));
  return reg;
}
