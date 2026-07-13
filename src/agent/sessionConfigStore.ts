// Session-scoped configuration store. Mirrors the runtime-mutable pattern
// of settingsStore (env seeds the initial value, the runtime can override
// without a restart, persists to the workspace dir so overrides survive
// page refreshes / gateway restarts).
//
// v1 surface is auto-approve-shaped (the only consumer today). Future
// per-session keys (model preference, custom cwd, ...) drop in here as
// sibling methods against the same on-disk file.

import fs from "node:fs/promises";

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

  async function persist(): Promise<void> {
    const data: PersistedFileShape = {
      autoApprove: {
        default: autoApproveDefault,
        overrides: Object.fromEntries(autoApproveOverrides),
      },
      metadata: Object.fromEntries(metadata),
      cwds: Object.fromEntries(sessionCwds),
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
  };
}