// Demo mode scenario file (`demo/demo-config.json` by default): the schema,
// loader/validator, and first-message scenario matching used by the scripted
// mock ACP agent (src/demo/mockAcpAgent.ts).
//
// Shape (see demo/README.md for the authoring guide):
//   {
//     "timing": { ... },                       // optional pacing knobs
//     "scenarios": [
//       {
//         "name": "...",
//         "firstMessage": "...",               // matched against the chat's first message
//         "responses": [                       // responses[0] answers the matching first
//           { "parts": [ ... ] },              // message; responses[n] answers the n-th
//           ...                                // later user message, whatever it says
//         ]
//       }
//     ]
//   }

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// Repo-root `demo/demo-config.json`. `__dirname` is `src/demo` under ts-node
// and `dist/demo` for the compiled build — both two levels below the root.
export const DEFAULT_DEMO_CONFIG_PATH = path.resolve(__dirname, "..", "..", "demo", "demo-config.json");

// Tool names (normalized: lowercase, alphanumerics only) that behave as the
// "ask the user" tool: instead of completing on a timer, they pop the
// question dialog and wait for the user to submit or skip. Covers Claude's
// `AskUserQuestion` and Codex's `request_user_input`.
const ASK_USER_TOOL_NAMES = new Set(["askuserquestion", "askuser", "requestuserinput", "userinput"]);

export function isAskUserToolName(name: string): boolean {
  return ASK_USER_TOOL_NAMES.has(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

// ACP's `ToolKind` vocabulary.
const TOOL_KINDS = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"] as const;

const delayMs = z.number().int().nonnegative();

const QuestionOptionSchema = z.strictObject({
  label: z.string().min(1),
  description: z.string().optional(),
});

// Mirrors the `questions[]` input of Claude's AskUserQuestion (and Codex's
// request_user_input), so the tool bubble shows a realistic input payload.
const QuestionSchema = z
  .strictObject({
    question: z.string().min(1),
    header: z.string().optional(),
    // Omit (or leave empty) for a free-text question.
    options: z.array(QuestionOptionSchema).optional(),
    multiSelect: z.boolean().optional(),
  })
  .superRefine((q, ctx) => {
    const labels = (q.options ?? []).map((o) => o.label);
    const dup = labels.find((l, i) => labels.indexOf(l) !== i);
    if (dup !== undefined) {
      ctx.addIssue({ code: "custom", path: ["options"], message: `duplicate option label "${dup}"` });
    }
    if (q.multiSelect && labels.length === 0) {
      ctx.addIssue({ code: "custom", path: ["multiSelect"], message: "multiSelect needs at least one option" });
    }
  });

const TextPartSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
  delayMs: delayMs.optional(),
});

const ToolCallPartSchema = z
  .strictObject({
    type: z.literal("tool_call"),
    // The tool's name, e.g. "Read", "Bash", "AskUserQuestion".
    name: z.string().min(1),
    // Display title shown in the transcript; defaults to `name`.
    title: z.string().min(1).optional(),
    kind: z.enum(TOOL_KINDS).optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    status: z.enum(["completed", "failed"]).optional(),
    // Error text shown when status is "failed".
    error: z.string().optional(),
    // How long the call shows as in progress before it completes.
    durationMs: delayMs.optional(),
    delayMs: delayMs.optional(),
  })
  .superRefine((part, ctx) => {
    if (!isAskUserToolName(part.name)) return;
    const parsed = z.strictObject({ questions: z.array(QuestionSchema).min(1) }).safeParse(part.input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        // Problems with `questions` itself get the expected shape spelled out;
        // deeper ones (a bad option, say) are clear enough on their own.
        const message =
          issue.path.length <= 1
            ? `${part.name} needs input.questions, a non-empty list of { question, header?, options?, multiSelect? } (${issue.message})`
            : issue.message;
        ctx.addIssue({ code: "custom", path: ["input", ...issue.path], message });
      }
    }
    if (part.output !== undefined || part.status !== undefined || part.error !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: `${part.name} is answered by the user — output/status/error are not allowed`,
      });
    }
  });

const ResponsePartSchema = z.discriminatedUnion("type", [TextPartSchema, ToolCallPartSchema]);

const ResponseSchema = z.strictObject({
  parts: z.array(ResponsePartSchema).min(1),
});

const ScenarioSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  firstMessage: z.string().refine((s) => normalizeMessage(s) !== "", "must not be blank"),
  responses: z.array(ResponseSchema).min(1),
});

const TimingSchema = z.strictObject({
  // Pause before the first part of every response (a "thinking" beat).
  responseDelayMs: delayMs.optional(),
  // Pause between streamed text chunks; 0 sends each text part in one chunk.
  textChunkDelayMs: delayMs.optional(),
  // Default in-progress time for tool calls without their own durationMs.
  toolCallDurationMs: delayMs.optional(),
});

const DemoConfigSchema = z
  .strictObject({
    description: z.string().optional(),
    timing: TimingSchema.optional(),
    scenarios: z.array(ScenarioSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Map<string, number>();
    cfg.scenarios.forEach((s, i) => {
      const key = normalizeMessage(s.firstMessage);
      const prev = seen.get(key);
      if (prev !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", i, "firstMessage"],
          message: `same firstMessage as scenarios[${prev}] ("${cfg.scenarios[prev].name}")`,
        });
      } else {
        seen.set(key, i);
      }
    });
  });

export type DemoQuestion = z.infer<typeof QuestionSchema>;
export type DemoTextPart = z.infer<typeof TextPartSchema>;
export type DemoToolCallPart = z.infer<typeof ToolCallPartSchema>;
export type DemoResponsePart = z.infer<typeof ResponsePartSchema>;
export type DemoResponse = z.infer<typeof ResponseSchema>;
export type DemoScenario = z.infer<typeof ScenarioSchema>;

export interface DemoTiming {
  responseDelayMs: number;
  textChunkDelayMs: number;
  toolCallDurationMs: number;
}

export interface DemoConfig {
  description?: string;
  timing: DemoTiming;
  scenarios: DemoScenario[];
}

export const DEFAULT_TIMING: DemoTiming = {
  responseDelayMs: 400,
  textChunkDelayMs: 30,
  toolCallDurationMs: 800,
};

// Questions of an ask-user tool part (validated at load time).
export function askUserQuestions(part: DemoToolCallPart): DemoQuestion[] {
  return (part.input as { questions: DemoQuestion[] }).questions;
}

// Validates parsed JSON. `source` only labels error messages.
export function parseDemoConfig(raw: unknown, source = "demo config"): DemoConfig {
  const result = DemoConfigSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${formatPath(issue.path)}: ${issue.message}`);
    throw new Error(`invalid demo config (${source}):\n${lines.join("\n")}`);
  }
  const { timing, ...rest } = result.data;
  return { ...rest, timing: { ...DEFAULT_TIMING, ...timing } };
}

export async function loadDemoConfig(configPath: string): Promise<DemoConfig> {
  let text: string;
  try {
    text = await fs.readFile(configPath, "utf8");
  } catch (err) {
    throw new Error(`could not read demo config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`demo config at ${configPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseDemoConfig(raw, configPath);
}

// Case-insensitive, whitespace-insensitive comparison key.
export function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findScenario(config: DemoConfig, message: string): DemoScenario | null {
  const key = normalizeMessage(message);
  return config.scenarios.find((s) => normalizeMessage(s.firstMessage) === key) ?? null;
}

function formatPath(p: ReadonlyArray<PropertyKey>): string {
  if (p.length === 0) return "(root)";
  return p
    .map((seg, i) => (typeof seg === "number" ? `[${seg}]` : `${i === 0 ? "" : "."}${String(seg)}`))
    .join("");
}
