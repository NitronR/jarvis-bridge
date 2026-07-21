// Small runtime-mutable settings file (currently just the default backend
// name) living in the system dir. Mirrors the existing auto-approve
// pattern: an env var seeds the initial value, the runtime can override it
// without a restart.

import fs from "node:fs/promises";

export interface SettingsStore {
  getDefaultBackendName(): string;
  setDefaultBackendName(name: string): Promise<void>;
}

interface SettingsFileShape {
  defaultBackendName?: string;
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

  return {
    getDefaultBackendName(): string {
      return current;
    },
    async setDefaultBackendName(name: string): Promise<void> {
      if (!validNames.includes(name)) {
        throw new Error(`unknown backend name: ${name}`);
      }
      current = name;
      await fs.writeFile(filePath, JSON.stringify({ defaultBackendName: name }, null, 2), "utf8");
    },
  };
}
