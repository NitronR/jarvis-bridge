# Setup simplification — design

Status: draft, pending user review
Date: 2026-07-21

## Problem

First-time setup of Jarvis Bridge takes more steps than the README documents, and two of
the required steps aren't documented at all:

1. `npm install` (root)
2. `cd frontend && npm install` — **undocumented**. `frontend/` is a separate npm package
   (its own `node_modules`), not linked via npm workspaces, so the root install doesn't
   cover it.
3. `cp agents.json.example agents.json` (then hand-edit) — **undocumented**, and required:
   `loadBackendProfiles()` (`src/agent/backendConfig.ts`) throws if `agents.json` is
   missing, so the gateway hard-fails on first run with a raw error and no setup guidance.
4. `cp .env.example .env` (then optionally edit)
5. `npm run build:web` (or `dev:web`) to get a working frontend
6. `npm run dev` to start the gateway

Goal: collapse this into as close to one command as possible, for both a local clone
workflow and a zero-clone trial workflow (`npx github:...`).

## Design

### 1. Directory layout

State currently lives in three places with three different conventions: repo-relative
`agents.json` (required, hard fail if missing), repo-relative `.env` (optional secrets),
and `JARVIS_BRIDGE_WORKSPACE` (default `~/.jarvis-bridge`, doubling as both the agent's
sandboxed cwd *and* the home for `settings.json`/`session_metadata.json`, which currently
makes those two files readable by the agent's own `readFile` tool).

New layout:

```
~/.jarvis-bridge/                 # workspace — UNCHANGED default. Pure agent sandbox,
                                   # pathGuard root. No migration needed for anything
                                   # the agent itself has written here.

~/.jarvis-bridge-system/           # NEW — sibling directory, never agent-readable
                                    # (outside pathGuard's boundary entirely, not nested
                                    # under the workspace)
  config/
    agents.json                    # moved from repo-relative ./agents.json
  logs/                            # reserved default for the (currently unwired — see
                                    # AGENTS.md "Backend configuration") per-session API
                                    # traffic logging feature once it's hooked up. No
                                    # migration needed today; nothing writes here yet.
  session_metadata.json            # moved from inside ~/.jarvis-bridge/
  settings.json                    # moved from inside ~/.jarvis-bridge/
```

Config changes (`src/config.ts`):
- `JARVIS_BRIDGE_WORKSPACE` default stays `~/.jarvis-bridge`.
- New `JARVIS_BRIDGE_SYSTEM_DIR` env var, default `~/.jarvis-bridge-system`.
- `JARVIS_BRIDGE_AGENTS_CONFIG` default changes from `./agents.json` to
  `<systemDir>/config/agents.json`.
- `settings.json` / `session_metadata.json` paths in `src/index.ts` change from
  `path.join(cfg.workspace, ...)` to `path.join(cfg.systemDir, ...)`.

**One-time migration** (in `scripts/setup.js`, see below): on first run under the new
code, if `~/.jarvis-bridge/settings.json` and/or `~/.jarvis-bridge/session_metadata.json`
exist (old location) and the new `~/.jarvis-bridge-system/` versions don't, move them.
Same for a repo-relative `agents.json`, if found, into `<systemDir>/config/agents.json`.
This only matters for your existing local setup — moved, not copied, so there's no stale
duplicate left behind.

### 2. npm workspace merge

Root `package.json` gains `"workspaces": ["frontend"]`. `frontend/package.json` is
unchanged. One root `npm install` now installs both backend and frontend dependencies —
removes the "forgot to `cd frontend && npm install`" failure mode entirely. Existing
scripts (`dev:web`, `build:web`, `preview:web`, `test:web`, which all `cd frontend && ...`)
keep working unchanged.

### 3. `scripts/setup.js`

Plain Node, no new dependencies. Idempotent — safe to run repeatedly, never overwrites
existing files.

1. Ensure `~/.jarvis-bridge/` and `~/.jarvis-bridge-system/config/` exist.
2. Run the one-time migration described above.
3. If `<systemDir>/config/agents.json` still doesn't exist after migration: probe `PATH`
   for known backend CLIs (`opencode`, `claude`) via a lightweight `which`-style check.
   Write `agents.json` containing only the profiles actually found, using the same
   `command`/`args`/`env` shape as `agents.json.example`. If none are found, write the
   example file verbatim and print a hint to edit it by hand.
4. If repo-local `.env` doesn't exist: copy from `.env.example`.
5. Non-interactive guard: if `!process.stdin.isTTY` or `process.env.CI` is set, skip any
   prompts entirely and just apply steps 1–4 with detected/default values — this matters
   because `postinstall` (below) also fires under `npm ci`, in Docker builds, and in CI.
6. Print a short summary: which backend(s) got auto-configured, what's still empty/manual
   (e.g. `SLACK_BOT_TOKEN`), and the next command to run.

### 4. Wiring

```json
"scripts": {
  "postinstall": "node scripts/setup.js",
  "setup": "node scripts/setup.js"
}
```

`postinstall` makes `npm install` alone do the full first-run setup (fetch deps → detect
backends → scaffold config). Because the script is idempotent and no-ops fast when config
already exists, subsequent `npm install` runs (e.g. after adding a new package later) do
nothing extra. `npm run setup` stays available as an explicit, discoverable re-run (e.g.
after installing a new backend CLI, to pick it up without deleting `agents.json` by hand).

### 5. npx / zero-clone support

Add:
```json
"bin": { "jarvis-bridge": "./bin/jarvis-bridge.js" }
```

`bin/jarvis-bridge.js` is a launcher: if `dist/index.js` or `public/index.html` is missing,
it builds them itself (`npm run build` + `npm run build:web`) before proceeding; then it
runs `scripts/setup.js` (idempotent, same as above) and `require()`s `dist/index.js` to
start the gateway. Deliberately **not** an npm `prepare` script — `prepare` fires on every
local `npm install` in the package's own directory, not just git-sourced ones, so wiring it
there would turn ordinary local installs into full rebuilds every time. The lazy
build-if-missing check in the launcher itself gets the same "npx just works" outcome
without that cost. `npx github:<owner>/<repo>` clones into npx's own cache, runs
`npm install` (installing devDependencies too, since it's not a production-only install),
then runs the `bin` entry, which does the one-time build. Because all state now lives
under `~/.jarvis-bridge*` (not repo-relative), this works identically regardless of whether
the code came from a real clone or npx's ephemeral cache — `npx github:bhanu-mac/jarvis_bridge`
becomes a genuine single command: fetch, build, configure, start.

### 6. Docs sync

- `README.md` "Getting started" rewritten to:
  ```bash
  npm install        # installs deps + auto-runs setup (postinstall)
  npm run dev
  ```
  plus a note on `npm run setup` for re-configuring, and the `npx github:...` one-liner.
- Remove the stale `AGENT_CMD`/`AGENT_ARGS` mentions in `README.md` (lines 9, 50, 57) —
  already dead, superseded by `agents.json` per `AGENTS.md`; this is pre-existing drift,
  not something the setup change introduces, but it's in the same section being rewritten.
- `AGENTS.md` "Backend configuration" section: update `agents.json`/`settings.json`/
  `session_metadata.json` paths to the new layout; note the workspace-merge (`frontend/`
  is no longer "not an npm workspaces link").
- `.env.example` / `agents.json.example`: no content changes needed, just where they get
  copied to.

## Out of scope

- Wiring up the currently-dead `.logs` API traffic logging feature — unrelated to setup,
  tracked as its own future task. This design only reserves its default path.
- Publishing to the public npm registry — `npx github:...` doesn't require it.
- Any change to `settings.json`'s or `session_metadata.json`'s *content* or the
  auto-approve/session-metadata logic itself — this is a location change only.

## Testing

- Backend: new test for `scripts/setup.js`'s migration logic (old-location files present →
  moved, not duplicated) and its idempotency (second run is a no-op).
- Manual verification: fresh `git clone` into a scratch dir, run `npm install`, confirm
  `agents.json`/`.env` get created and the gateway starts with `npm run dev`; separately
  verify an existing checkout with old-layout `~/.jarvis-bridge/settings.json` gets migrated
  correctly on `npm run setup`.
