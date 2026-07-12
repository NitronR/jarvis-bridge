// Loads the static, hand-edited list of available agent backends from a
// JSON file (agents.json). Never re-read at runtime beyond process start —
// restart the process to pick up profile changes.

import fs from "node:fs/promises";

export interface BackendProfile {
  name: string;
  kind: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface BackendsFileShape {
  backends?: Array<{
    name?: unknown;
    kind?: unknown;
    command?: unknown;
    args?: unknown;
    env?: unknown;
  }>;
}

export async function loadBackendProfiles(configPath: string): Promise<BackendProfile[]> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (err) {
    throw new Error(
      `could not read agents.json at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: BackendsFileShape;
  try {
    parsed = JSON.parse(raw) as BackendsFileShape;
  } catch (err) {
    throw new Error(`agents.json at ${configPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const entries = parsed.backends;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`agents.json at ${configPath} must list at least one backend under "backends"`);
  }
  const seen = new Set<string>();
  const profiles: BackendProfile[] = entries.map((e, i) => {
    if (typeof e.name !== "string" || !e.name) throw new Error(`backends[${i}].name must be a non-empty string`);
    if (typeof e.kind !== "string" || !e.kind) throw new Error(`backends[${i}].kind must be a non-empty string`);
    if (typeof e.command !== "string" || !e.command) throw new Error(`backends[${i}].command must be a non-empty string`);
    if (!Array.isArray(e.args) || !e.args.every((a) => typeof a === "string")) {
      throw new Error(`backends[${i}].args must be an array of strings`);
    }
    if (seen.has(e.name)) throw new Error(`duplicate backend name in agents.json: ${e.name}`);
    seen.add(e.name);
    const env =
      e.env && typeof e.env === "object"
        ? Object.fromEntries(
            Object.entries(e.env as Record<string, unknown>).filter(
              (kv): kv is [string, string] => typeof kv[1] === "string",
            ),
          )
        : undefined;
    return { name: e.name, kind: e.kind, command: e.command, args: e.args as string[], env };
  });
  return profiles;
}
