// Composes one BackendPool per configured agent profile (agents.json) and
// exposes a runtime-mutable "default backend" concept backed by a
// SettingsStore. Only the default profile is spawned eagerly at startup;
// every other profile is spawned lazily on first access and cached.
//
// This is the layer that lets multiple backend *kinds* (opencode, Claude, ...)
// be live concurrently, on top of the existing per-cwd BackendPool which
// only ever pooled one kind at a time.

import { createAgentBackend } from "./index";
import { createBackendPool, type BackendPool, type BackendPoolSessionEntry, type CreateAgentBackendFn } from "./backendPool";
import type { BackendProfile } from "./backendConfig";
import type { SettingsStore } from "./settingsStore";
import type { AgentBackend, AgentSession, ChatSessionSummary } from "./types";

export interface RegistrySessionEntry {
  backend: AgentBackend;
  backendName: string;
  cwd: string;
  summary: ChatSessionSummary;
}

export interface BackendRegistry {
  getDefaultBackendName(): string;
  setDefaultBackendName(name: string): Promise<void>;
  listBackendNames(): string[];
  getDefaultBackend(): Promise<AgentBackend>;
  getBackend(name: string): Promise<AgentBackend>;
  listSessions(): Promise<RegistrySessionEntry[]>;
  findSession(sessionId: string): Promise<RegistrySessionEntry | null>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  deleteSession(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export async function createBackendRegistry(opts: {
  profiles: BackendProfile[];
  settings: SettingsStore;
  workspace: string;
  logsDir?: string;
  autoApprove: boolean;
}): Promise<BackendRegistry> {
  const { profiles, settings, workspace, logsDir, autoApprove } = opts;
  const byName = new Map(profiles.map((p) => [p.name, p]));
  const pools = new Map<string, BackendPool>();
  const inFlight = new Map<string, Promise<BackendPool>>();

  async function spawnPool(name: string): Promise<BackendPool> {
    const profile = byName.get(name);
    if (!profile) throw new Error(`unknown backend name: ${name}`);
    const factory: CreateAgentBackendFn = async (role, cfg, o) =>
      createAgentBackend(
        role,
        {
          kind: profile.kind,
          command: profile.command,
          args: profile.args,
          env: profile.env as NodeJS.ProcessEnv | undefined,
          model: cfg.model,
        },
        { workspace: cfg.cwd, logsDir: o.logsDir ?? logsDir },
      );

    const defaultBackend = await factory("chat", { command: profile.command, args: profile.args, cwd: workspace }, { workspace, logsDir });
    defaultBackend.setDefaultAutoApprove?.(autoApprove);
    return createBackendPool(defaultBackend, workspace, factory);
  }

  async function getPool(name: string): Promise<BackendPool> {
    const cached = pools.get(name);
    if (cached) return cached;
    const pending = inFlight.get(name);
    if (pending) return pending;
    const p = (async () => {
      try {
        const pool = await spawnPool(name);
        pools.set(name, pool);
        return pool;
      } finally {
        inFlight.delete(name);
      }
    })();
    inFlight.set(name, p);
    return p;
  }

  // Eagerly spawn only the current default, mirroring today's single-backend
  // startup behavior (and its healthcheck-before-serving contract in src/index.ts).
  await getPool(settings.getDefaultBackendName());

  const registry: BackendRegistry = {
    getDefaultBackendName(): string {
      return settings.getDefaultBackendName();
    },
    async setDefaultBackendName(name: string): Promise<void> {
      if (!byName.has(name)) throw new Error(`unknown backend name: ${name}`);
      await settings.setDefaultBackendName(name);
    },
    listBackendNames(): string[] {
      return profiles.map((p) => p.name);
    },
    async getDefaultBackend(): Promise<AgentBackend> {
      const pool = await getPool(settings.getDefaultBackendName());
      return pool.getDefaultBackend();
    },
    async getBackend(name: string): Promise<AgentBackend> {
      const pool = await getPool(name);
      return pool.getDefaultBackend();
    },
    async listSessions(): Promise<RegistrySessionEntry[]> {
      const out: RegistrySessionEntry[] = [];
      for (const name of profiles.map((p) => p.name)) {
        const pool = pools.get(name);
        if (!pool) continue; // never spawned — nothing to list
        const entries: BackendPoolSessionEntry[] = await pool.listSessions();
        for (const e of entries) {
          out.push({
            backend: e.backend,
            backendName: name,
            cwd: e.cwd,
            summary: e.summary,
          });
        }
      }
      return out;
    },
    async findSession(sessionId: string): Promise<RegistrySessionEntry | null> {
      const all = await registry.listSessions();
      return all.find((e) => e.summary.sessionId === sessionId) ?? null;
    },
    async getSession(sessionId: string): Promise<AgentSession | null> {
      for (const name of profiles.map((p) => p.name)) {
        const pool = pools.get(name);
        if (!pool) continue;
        const s = await pool.getSession(sessionId);
        if (s) return s;
      }
      return null;
    },
    async deleteSession(sessionId: string): Promise<void> {
      const entry = await registry.findSession(sessionId);
      if (!entry) throw new Error(`session not found: ${sessionId}`);
      if (!entry.backend.deleteSession) throw new Error(`delete not supported by backend: ${entry.backendName}`);
      await entry.backend.deleteSession(sessionId);
    },
    async shutdown(): Promise<void> {
      for (const pool of pools.values()) {
        for (const backend of pool.listBackends()) {
          await backend.shutdown().catch(() => {});
        }
      }
    },
  };

  return registry;
}
