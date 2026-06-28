// Tool parameter and result types. Validated with Zod at the boundary;
// kept minimal at the implementation layer.

import { z } from "zod";

export const ReadFileParamsSchema = z.object({
  path: z.string().min(1),
  encoding: z
    .union([z.literal("utf-8"), z.literal("utf8"), z.literal("base64")])
    .optional(),
});

export const WriteFileParamsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>;
export type WriteFileParams = z.infer<typeof WriteFileParamsSchema>;

export type ToolResult = string | void;
export type ToolHandler = (params: unknown) => Promise<ToolResult>;
