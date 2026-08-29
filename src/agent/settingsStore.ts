// Small runtime-mutable settings file (currently just the default backend
// name) living in the system dir. Mirrors the existing auto-approve
// pattern: an env var seeds the initial value, the runtime can override it
// without a restart.

import fs from "node:fs/promises";

// What options a backend reports, cached so the Settings dialog can offer
// defaults for a backend that has no live session right now. Deliberately
// without `currentValue` — that is one session's live value, not a default.
export interface CatalogOption {
  id: string;
  name: string;
  category?: string;
  options: Array<{ value: string; name: string }>;
}

export interface SettingsStore {
  getDefaultBackendName(): string;
  setDefaultBackendName(name: string): Promise<void>;
  getConfigCatalog(backendName: string): CatalogOption[];
  setConfigCatalog(backendName: string, options: CatalogOption[]): Promise<void>;
  getConfigDefaults(backendName: string): Record<string, string>;
  setConfigDefault(backendName: string, configId: string, value: string | null): Promise<void>;
}

interface SettingsFileShape {
  defaultBackendName?: string;
  configCatalog?: Record<string, CatalogOption[]>;
  configDefaults?: Record<string, Record<string, string>>;
}

export async function createSettingsStore(opts: {
  path: string;
  envDefault: string;
  validNames: string[];
}): Promise<SettingsStore> {
  const { path: filePath, envDefault, validNames } = opts;
  let current = validNames.includes(envDefault) ? envDefault : validNames[0];

  let persisted: SettingsFileShape = {};
  try {
    const raw = await fs.readFile(filePath, "utf8");
    persisted = JSON.parse(raw) as SettingsFileShape;
  } catch {
    // Missing or unreadable file — fall through to the env-seeded default.
  }
  if (persisted.defaultBackendName && validNames.includes(persisted.defaultBackendName)) {
    current = persisted.defaultBackendName;
  }
  let configCatalog: Record<string, CatalogOption[]> = persisted.configCatalog ?? {};
  let configDefaults: Record<string, Record<string, string>> = persisted.configDefaults ?? {};

  // Every key is written on every save — a single-key overwrite here would
  // silently drop the others (it did, until 2026-08-28).
  async function persist(): Promise<void> {
    const data: SettingsFileShape = {
      defaultBackendName: current,
      configCatalog,
      configDefaults,
    };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  return {
    getDefaultBackendName(): string {
      return current;
    },
    async setDefaultBackendName(name: string): Promise<void> {
      if (!validNames.includes(name)) {
        throw new Error(`unknown backend name: ${name}`);
      }
      current = name;
      await persist();
    },
    getConfigCatalog(backendName: string): CatalogOption[] {
      return configCatalog[backendName] ?? [];
    },
    async setConfigCatalog(backendName: string, options: CatalogOption[]): Promise<void> {
      // Called on every /chat/init — only touch disk when it actually changed.
      if (JSON.stringify(configCatalog[backendName] ?? []) === JSON.stringify(options)) return;
      configCatalog = { ...configCatalog, [backendName]: options };
      await persist();
    },
    getConfigDefaults(backendName: string): Record<string, string> {
      return { ...(configDefaults[backendName] ?? {}) };
    },
    async setConfigDefault(backendName: string, configId: string, value: string | null): Promise<void> {
      const cur = { ...(configDefaults[backendName] ?? {}) };
      if (value == null) delete cur[configId];
      else cur[configId] = value;
      const next = { ...configDefaults };
      if (Object.keys(cur).length === 0) delete next[backendName];
      else next[backendName] = cur;
      configDefaults = next;
      await persist();
    },
  };
}
