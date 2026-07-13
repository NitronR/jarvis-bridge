// Per-cwd pool of agent backends. Keyed by `path.resolve(cwd)`. Each
// distinct cwd gets its own backend subprocess so the agent runs with the
// right working directory.

import path from "node:path";
import type {
  AgentBackend,
  AgentSession,
  ChatSessionSummary,
} from "./types";

export interface BackendPoolEntry {
  backend: AgentBackend;
  cwd: string;
}

export interface BackendPoolSessionEntry {
  backend: AgentBackend;
  cwd: string;
  summary: ChatSessionSummary;
}

export interface BackendPool {
  getDefaultBackend(): AgentBackend;
  getOrCreate(cwd: string): Promise<AgentBackend>;
  listBackends(): AgentBackend[];
  findSession(sessionId: string): Promise<BackendPoolSessionEntry | null>;
  listSessions(): Promise<BackendPoolSessionEntry[]>;
  getSession(sessionId: string): Promise<AgentSession | null>;
}

export type BackendFactory = (
  cfg: { command: string; args: readonly string[]; cwd: string },
  opts: { workspace: string; logsDir?: string },
) => Promise<AgentBackend>;

export type CreateAgentBackendFn = (
  role: "chat",
  cfg: { command: string; args: readonly string[]; cwd: string; env?: NodeJS.ProcessEnv; model?: string },
  opts: { workspace: string; logsDir?: string },
) => Promise<AgentBackend>;

export async function createBackendPool(
  defaultBackend: AgentBackend,
  canonicalWorkspace: string,
  factory: CreateAgentBackendFn,
): Promise<BackendPool> {
  const inFlight = new Map<string, Promise<AgentBackend>>();
  const resolved = new Map<string, AgentBackend>();

  // Seed the default workspace eagerly.
  resolved.set(path.resolve(canonicalWorkspace), defaultBackend);

  return {
    getDefaultBackend(): AgentBackend {
      return defaultBackend;
    },

    async getOrCreate(cwd: string): Promise<AgentBackend> {
      const key = path.resolve(cwd);
      const cached = resolved.get(key);
      if (cached) return cached;
      const pending = inFlight.get(key);
      if (pending) return pending;

      // Build the config for the per-cwd backend from the default backend's
      // spawn options. We read them via a public accessor on AcpAgentBackend.
      const def = defaultBackend as AgentBackend & {
        getSpawnOptions?: () => { command: string; args: readonly string[] };
      };
      const spawnOpts = def.getSpawnOptions?.();
      const cfg = {
        command: spawnOpts?.command ?? "true",
        args: spawnOpts?.args ?? [],
        cwd: key,
      };
      const p = (async () => {
        try {
          const backend = await factory("chat", cfg, { workspace: canonicalWorkspace });
          // New backend instances start with their own auto-approve default
          // (false) — inherit the pool's current default so opening a new
          // workspace doesn't silently reset auto-approve.
          backend.setDefaultAutoApprove?.(defaultBackend.getDefaultAutoApprove?.() ?? false);
          resolved.set(key, backend);
          return backend;
        } catch (err) {
          // Delete both caches on failure so a failed spawn doesn't poison the cache.
          inFlight.delete(key);
          resolved.delete(key);
          throw err;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, p);
      return p;
    },

    listBackends(): AgentBackend[] {
      return Array.from(resolved.values());
    },

    listSessions(): Promise<BackendPoolSessionEntry[]> {
      return listSessionsImpl(resolved);
    },

    async findSession(sessionId: string): Promise<BackendPoolSessionEntry | null> {
      const all: BackendPoolSessionEntry[] = await listSessionsImpl(resolved);
      return all.find((e: BackendPoolSessionEntry) => e.summary.sessionId === sessionId) ?? null;
    },

    async getSession(sessionId: string): Promise<AgentSession | null> {
      for (const [, backend] of resolved) {
        if (!backend.getSession) continue;
        const s = backend.getSession(sessionId);
        if (s) return s;
      }
      return null;
    },
  };
}

async function listSessionsImpl(
  resolved: Map<string, AgentBackend>,
): Promise<BackendPoolSessionEntry[]> {
  const out: BackendPoolSessionEntry[] = [];
  for (const [cwd, backend] of resolved) {
    if (!backend.listSessions) continue;
    try {
      const sessions = await backend.listSessions();
      for (const summary of sessions) {
        out.push({ backend, cwd, summary });
      }
    } catch {
      // backend may be down — skip
    }
  }
  return out;
}

// Type augmentation: allow callers to optionally pass `__cfg` to the default
// backend for the pool's factory to reuse. This avoids re-parsing env.
export type BackendWithConfig = AgentBackend & {
  getSpawnOptions?: () => { command: string; args: readonly string[] };
};