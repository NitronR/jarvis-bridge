// Session-scoped configuration store. Mirrors the runtime-mutable pattern
// of settingsStore (env seeds the initial value, the runtime can override
// without a restart, persists to the workspace dir so overrides survive
// page refreshes / gateway restarts).
//
// v1 surface is auto-approve-shaped (the only consumer today). Future
// per-session keys (model preference, custom cwd, ...) drop in here as
// sibling methods against the same on-disk file.

import fs from "node:fs/promises";
import type { RateLimitWindow, UsageTotals } from "./types";

export interface SessionMetadata {
  customTitle?: string;
  pinned?: boolean;
  group?: string;
}

export interface SessionMetadataPatch {
  customTitle?: string | null;
  pinned?: boolean;
  group?: string | null;
}

export interface SessionConfigStore {
  getAutoApproveDefault(): boolean;
  setAutoApproveDefault(v: boolean): Promise<void>;
  getAutoApproveOverride(sessionId: string): boolean | undefined;
  setAutoApproveOverride(sessionId: string, v: boolean | null): Promise<void>;
  getMetadata(sessionId: string): SessionMetadata | undefined;
  setMetadata(sessionId: string, patch: SessionMetadataPatch): Promise<void>;
  getSessionCwd(sessionId: string): string | undefined;
  setSessionCwd(sessionId: string, cwd: string): Promise<void>;
  getLastUsage(sessionId: string): UsageTotals | undefined;
  setLastUsage(sessionId: string, usage: UsageTotals): Promise<void>;
}

interface PersistedFileShape {
  autoApprove?: {
    default?: boolean;
    overrides?: Record<string, boolean>;
  };
  metadata?: Record<string, {
    customTitle?: unknown;
    pinned?: unknown;
    group?: unknown;
  }>;
  cwds?: Record<string, string>;
  usage?: Record<string, unknown>;
}

function sanitizeUsage(raw: unknown): UsageTotals | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.requests !== "number" ||
    typeof r.input_tokens !== "number" ||
    typeof r.output_tokens !== "number" ||
    typeof r.cache_read_tokens !== "number" ||
    typeof r.cache_write_tokens !== "number"
  ) {
    return undefined;
  }
  const out: UsageTotals = {
    requests: r.requests,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cache_read_tokens: r.cache_read_tokens,
    cache_write_tokens: r.cache_write_tokens,
  };
  if (typeof r.context_limit === "number") out.context_limit = r.context_limit;
  if (typeof r.context_used === "number") out.context_used = r.context_used;
  if (typeof r.thought_tokens === "number") out.thought_tokens = r.thought_tokens;
  if (r.cost && typeof r.cost === "object") {
    const c = r.cost as Record<string, unknown>;
    if (typeof c.amount === "number" && typeof c.currency === "string") {
      out.cost = { amount: c.amount, currency: c.currency };
    }
  }
  if (r.rate_limits && typeof r.rate_limits === "object") {
    const rateLimits: Record<string, RateLimitWindow> = {};
    for (const [key, w] of Object.entries(r.rate_limits as Record<string, unknown>)) {
      if (!w || typeof w !== "object") continue;
      const win = w as Record<string, unknown>;
      if (typeof win.status !== "string") continue;
      const window: RateLimitWindow = { status: win.status as RateLimitWindow["status"] };
      if (typeof win.utilization === "number") window.utilization = win.utilization;
      if (typeof win.resetsAt === "number") window.resetsAt = win.resetsAt;
      rateLimits[key] = window;
    }
    if (Object.keys(rateLimits).length > 0) out.rate_limits = rateLimits;
  }
  return out;
}

function sanitizeMetadata(raw: unknown): SessionMetadata | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SessionMetadata = {};
  if (typeof r.customTitle === "string") out.customTitle = r.customTitle;
  if (typeof r.pinned === "boolean") out.pinned = r.pinned;
  if (typeof r.group === "string") out.group = r.group;
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function createSessionConfigStore(opts: {
  path: string;
  envDefault: boolean;
}): Promise<SessionConfigStore> {
  const { path: filePath, envDefault } = opts;

  let persisted: PersistedFileShape = {};
  try {
    const raw = await fs.readFile(filePath, "utf8");
    persisted = JSON.parse(raw) as PersistedFileShape;
  } catch {
    // Missing or unreadable file — fall through to env-seeded default.
  }

  let autoApproveDefault: boolean =
    typeof persisted.autoApprove?.default === "boolean" ? persisted.autoApprove.default : envDefault;
  const autoApproveOverrides: Map<string, boolean> = new Map(
    Object.entries(persisted.autoApprove?.overrides ?? {}).filter(
      (e): e is [string, boolean] => typeof e[1] === "boolean",
    ),
  );
  const metadata: Map<string, SessionMetadata> = new Map();
  for (const [sid, raw] of Object.entries(persisted.metadata ?? {})) {
    const sanitized = sanitizeMetadata(raw);
    if (sanitized) metadata.set(sid, sanitized);
  }
  const sessionCwds: Map<string, string> = new Map(
    Object.entries(persisted.cwds ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  const lastUsage: Map<string, UsageTotals> = new Map();
  for (const [sid, raw] of Object.entries(persisted.usage ?? {})) {
    const sanitized = sanitizeUsage(raw);
    if (sanitized) lastUsage.set(sid, sanitized);
  }

  async function persist(): Promise<void> {
    const data: PersistedFileShape = {
      autoApprove: {
        default: autoApproveDefault,
        overrides: Object.fromEntries(autoApproveOverrides),
      },
      metadata: Object.fromEntries(metadata),
      cwds: Object.fromEntries(sessionCwds),
      usage: Object.fromEntries(lastUsage),
    };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  return {
    getAutoApproveDefault(): boolean {
      return autoApproveDefault;
    },
    async setAutoApproveDefault(v: boolean): Promise<void> {
      autoApproveDefault = v;
      await persist();
    },
    getAutoApproveOverride(sessionId: string): boolean | undefined {
      return autoApproveOverrides.get(sessionId);
    },
    async setAutoApproveOverride(sessionId: string, v: boolean | null): Promise<void> {
      if (v == null) {
        autoApproveOverrides.delete(sessionId);
      } else {
        autoApproveOverrides.set(sessionId, v);
      }
      await persist();
    },
    getMetadata(sessionId: string): SessionMetadata | undefined {
      const cur = metadata.get(sessionId);
      return cur ? { ...cur } : undefined;
    },
    async setMetadata(sessionId: string, patch: SessionMetadataPatch): Promise<void> {
      const cur: SessionMetadata = { ...(metadata.get(sessionId) ?? {}) };
      if (patch.customTitle !== undefined) {
        if (patch.customTitle == null) delete cur.customTitle;
        else cur.customTitle = patch.customTitle;
      }
      if (patch.pinned !== undefined) {
        cur.pinned = patch.pinned;
      }
      if (patch.group !== undefined) {
        if (patch.group == null) delete cur.group;
        else cur.group = patch.group;
      }
      if (Object.keys(cur).length === 0) {
        metadata.delete(sessionId);
      } else {
        metadata.set(sessionId, cur);
      }
      await persist();
    },
    getSessionCwd(sessionId: string): string | undefined {
      return sessionCwds.get(sessionId);
    },
    async setSessionCwd(sessionId: string, cwd: string): Promise<void> {
      sessionCwds.set(sessionId, cwd);
      await persist();
    },
    getLastUsage(sessionId: string): UsageTotals | undefined {
      const cur = lastUsage.get(sessionId);
      return cur ? { ...cur } : undefined;
    },
    async setLastUsage(sessionId: string, usage: UsageTotals): Promise<void> {
      lastUsage.set(sessionId, usage);
      await persist();
    },
  };
}