# Per-backend default config options

**Date:** 2026-08-28
**Status:** design, not yet implemented
**Builds on:** `2026-08-28-session-config-pickers-design.md` (shipped — the generic
`configOptions` transport this reuses)

## Goal

Set a default Mode / Effort / Agent **per backend** in the Settings dialog. Sessions
inherit it unless they have their own per-session override.

Resolution chain: **session override → backend default → whatever the agent starts with.**
Same shape as `effectiveAutoApprove` (`src/agent/acp/index.ts:721`) — resolved at use
time, never baked into the session.

## Prerequisite: `settings.json` is overwritten, not merged

`setDefaultBackendName` writes `JSON.stringify({ defaultBackendName: name })`
(`src/agent/settingsStore.ts:44`) — a whole-file overwrite. Any second key in that file
is wiped the next time the default backend changes.

Fix first, as its own task: hold all keys in memory, write them all on every `persist()`,
exactly as `sessionConfigStore.persist()` does. The regression test is: set a config
default → change the default backend → assert the config default survived.

## Storage

Two new keys in `settings.json` (backend-scoped, system dir — the right home, since
neither is per-session):

```ts
// What options each backend actually reports. Populated from live sessions.
configCatalog: Record<string /* backendName */, CatalogOption[]>;
// What the user picked as that backend's default.
configDefaults: Record<string /* backendName */, Record<string /* configId */, string>>;
```

```ts
interface CatalogOption {
  id: string;
  name: string;
  category?: string;
  options: Array<{ value: string; name: string }>;
}
```

`CatalogOption` deliberately **drops `currentValue`**. That field is one session's live
value, not a default — storing it would invite reading it as one.

## `SettingsStore` surface

```ts
getConfigCatalog(backendName: string): CatalogOption[];
setConfigCatalog(backendName: string, options: CatalogOption[]): Promise<void>;
getConfigDefaults(backendName: string): Record<string, string>;
setConfigDefault(backendName: string, configId: string, value: string | null): Promise<void>;
```

`setConfigCatalog` is a no-op (no disk write) when the serialized catalog is unchanged —
otherwise every `/chat/init` would write to disk.
`setConfigDefault(…, null)` clears the entry.

## Wiring: through the registry, not a new `createServer` option

All four methods are proxied on `BackendRegistry`, next to the existing
`getDefaultBackendName` / `setDefaultBackendName` pair (`src/agent/backendRegistry.ts:23-35`).

This is deliberate. `AGENTS.md` documents a release where `sessionConfig` wasn't passed
into `createServer` and persistence silently stopped — possible only because it's an
*optional* option, so omitting it still typechecks. `registry` is required, so
`registry.getConfigDefaults(name)` cannot be forgotten the same way. No new
`CreateServerOptions` field.

## Applying, in `/chat/init`

**Populate the catalog** — in both branches, once a session exists: if
`backend.getSessionConfigOptions(session.id)` returns non-null, strip `currentValue` and
`await registry.setConfigCatalog(backendName, stripped)`.

**Apply defaults** — in both branches (new *and* resumed), before the existing
`configOverrides` re-apply loop:

```ts
const defaults = registry.getConfigDefaults(backendName);
const overrides = opts.sessionConfig?.getConfigOverrides(session.id) ?? {};
for (const [configId, value] of Object.entries(defaults)) {
  if (overrides[configId] !== undefined) continue;  // the session's own choice wins
  try {
    await backend.setSessionConfigOption?.(session.id, configId, value);
  } catch (e) {
    console.log(`[INIT]   default ${configId}=${value} failed: ${e instanceof Error ? e.message : e}`);
  }
}
```

Best-effort per option, logged, never fails init — a default for an option the agent
stopped reporting must not break session creation.

Running this on resume too is what makes resume deterministic without stamping the
default into `session_metadata.json`. Stamping was considered and rejected: it grows the
file by every option × every session ever created, freezes sessions against later changes
to the backend default, and destroys the "user chose this" vs "inherited this"
distinction that a future reset button or "overridden" badge would need.

## Routes

- `GET /settings/config-defaults` →
  `{ ok: true, backends: [{ name, options: CatalogOption[], defaults: Record<configId, string> }] }`,
  one entry per `registry.listBackendNames()`. A backend never used yet has
  `options: []`.
- `PUT /settings/config-default` `{ backend, configId, value: string | null }` →
  `{ ok: true, defaults }`. 400 on an unknown backend name, or on a `configId`/`value`
  not present in that backend's catalog. `configId: "model"` is rejected — the model
  default is a separate concern and `/chat/model` owns model state.

## Settings UI

A section in `SettingsDialog.tsx` under the existing default-backend dropdown: one group
per backend, one `<Select>` per catalogued option, each with a leading **"Agent default"**
entry that clears the override (`value: null`).

Backends with an empty catalog render *"Start a chat on this backend to configure its
defaults."* — the honest degradation, and the reason the catalog is cached at all.

**Worth knowing:** setting a backend's Mode default to `bypassPermissions` applies it to
every new session on that backend, silently. That is the feature working as specified,
but it is a wider blast radius than the per-session picker.

## Non-goals

- **Boolean options** (`fast`). Still filtered out — the pickers render string selects.
- **Live sync** of `current_mode_update` / `config_option_update`. Unchanged.
- **Per-cwd or per-group defaults.** Backend-wide only.
- **A model default.** `model` is excluded here as it is in the session pickers.

## Tests

**Backend** (`node:test`)
- `settingsStore.test.ts` — all keys survive a `setDefaultBackendName` (the clobber
  regression); catalog + defaults round-trip through disk; `setConfigDefault(…, null)`
  deletes; `setConfigCatalog` with an unchanged catalog writes nothing.
- `backendRegistry.test.ts` — the four proxies reach the store.
- `server.test.ts` — `/chat/init` populates the catalog; a backend default is applied to a
  new session; applied on resume; **not** applied when a session override exists for that
  id; both routes' shapes; 400s for unknown backend / configId / value / `model`.

**Frontend** (Vitest)
- `SettingsDialog.test.tsx` — **new file**, the dialog has no test coverage today —
  renders a select per catalogued option; empty catalog
  renders the "start a chat" hint; picking a value PUTs; picking "Agent default" PUTs
  `null`.

## Files touched

```
src/agent/settingsStore.ts         merge-on-write + 4 methods
src/agent/backendRegistry.ts       4 proxies
src/server.ts                      2 routes, catalog populate, apply loop (both branches)
frontend/src/api/types.ts          CatalogOption, ConfigDefaultsState
frontend/src/components/SettingsDialog.tsx   new section
```
Plus the four test files above.
