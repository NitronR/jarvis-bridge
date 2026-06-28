# 06 — Context Injection & Workspace

Jarvis Bridge keeps all agent state in a single **workspace** directory. On first run it lays down a
template; before each chat turn it can prepend a **context** block built from the workspace files.

## Workspace location & layout

Default `~/.jarvis-bridge` (override with `JARVIS_BRIDGE_WORKSPACE`). A nested `.jarvis-bridge/`
holds machine state.

```
<workspace>/
├── IDENTITY.md, SOUL.md, USER.md, AGENTS.md, MEMORY.md, TOOLS.md, HEARTBEAT.md  # context files
├── memory/<YYYY-MM-DD>.md         # daily logs (read by context injection in "main" mode)
├── skills/<name>/...              # installed skills (see skill-UI convention below)
├── .skills-data/<name>/data.json  # per-skill persisted state (workspace top level)
└── .jarvis-bridge/
    ├── chat-session-metadata.json # UI-side per-session metadata (title/pinned/group/cwd)
    ├── onboarded                  # first-run marker (ISO timestamp)
    └── logs/agent-chat-<isoStamp>.log # agent subprocess stderr
```

## Context injection — `src/context/index.ts`

Prepends workspace "system context" to outgoing messages so the agent knows who it is, who the user
is, and what is in long-term memory — without the user re-stating it each turn.

### Modes

- `ContextMode = "main" | "onboarding" | "minimal"` — *which* files to consider.
- `InjectContextMode = "full" | "paths"` — *how much* to embed.
- `CONTEXT_READY_MESSAGE = "Context loaded. Ready for the user's message."` — the sentinel user text
  for the hidden priming turn (the UI hides this turn and the assistant reply that follows it).

### `buildContext(workspace, mode, injectMode = "full")`

> The function's own default is `"full"`, but the gateway always passes the env-derived mode, which
> defaults to `"paths"` (`INJECT_CONTEXT_MODE`). So in practice the default behavior is the
> token-light `paths` catalog.

- `onboarding` mode short-circuits to a fixed onboarding prompt that tells the agent to interview the
  user and write `IDENTITY.md` / `USER.md` via the `write_file` tool.
- Otherwise it reads: `IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, `MEMORY.md`, `TOOLS.md`,
  `HEARTBEAT.md`, plus daily logs `memory/<today>.md` and `memory/<yesterday>.md`.
- **`paths` mode (default):** emit a compact catalog — for each file that exists, a bullet
  `- **<name>** — <one-line summary>`. Daily memory files are listed only in `main` mode. Wrap with a
  `[System context - do not repeat to user]` header and a `---` separator. The agent reads files on
  demand → token-light.
- **`full` mode:** inline each file's contents under section headers (`## Identity`, `## Soul`,
  `## User`, `## Workspace Rules`, `## Long-Term Memory`, `## Tool Notes`, `## Heartbeat Tasks`,
  `## Recent Context`). `MEMORY.md` is included only in `main` mode. Skip template-only files via an
  `isFilled()` check (strip comments; require a real value, not an empty `- **Key:**` line).
- Missing files read as `""` (never throw).

### `wrapMessageWithContext(context, userMessage)`

Returns `` `${context}User message: ${userMessage}` ``. The `"User message: "` marker is what the ACP
backend strips when reconstructing replayed user turns (see [02-acp-backend.md](02-acp-backend.md)).

### How it is used

- **Priming:** `POST /chat/prime-context` builds context in `main` mode and sends it once as a hidden
  turn (`CONTEXT_READY_MESSAGE`), draining the response. Normal turns then send the message alone.
- **Onboarding:** `POST /chat/send` with `onboarding: true` prepends onboarding context to the first
  real message.
- Context injection is enabled only when the session's cwd equals the canonical workspace (a chat
  scoped to an arbitrary project folder does not get workspace context). Controlled by env
  `INJECT_CONTEXT` (anything but `"false"` enables) and `INJECT_CONTEXT_MODE` (`full` else `paths`).

## First-run bootstrap — `src/workspace/bootstrap.ts`

Idempotent; never overwrites existing files.

- `INITIAL_FILES = ["SOUL.md","IDENTITY.md","USER.md","AGENTS.md","MEMORY.md","TOOLS.md","HEARTBEAT.md"]`.
- `isOnboarded(workspace)` — existence check on `.jarvis-bridge/onboarded`.
- `isFilled(content)` — regex for a real `- **Name:** <value>` line (distinguishes a filled file from
  a template).
- `getWorkspaceFillStatus` / `hasFilledIdentityAndUser` — whether `IDENTITY.md` & `USER.md` are real.
- `copyInitialWorkspace(workspace, initialWorkspacePath, initialSkillNames = [])`:
  - Create `.jarvis-bridge/` and `memory/`.
  - Copy each `INITIAL_FILES` entry from the template **only if the destination is absent**
    (skip-on-exist; failures warned, not fatal).
  - **Skill install:** for each requested skill, resolve dependencies first. A skill dir may contain a
    `dependencies` file (newline/comma-separated skill names); copy deps before the skill. Guard
    against cycles (`visiting` set) and double-copy (`copied` set); skip already-present skills and
    non-directories; copy with `fs.cp(..., { recursive: true })`.
- `ensureWorkspaceReady` — copy the template **only when not onboarded and identity/user are
  unfilled** (so it never clobbers an established workspace).
- `completeOnboarding` — write the current ISO timestamp into the `onboarded` marker.

Env: `INITIAL_WORKSPACE_PATH` (template source; default `<projectRoot>/initial_workspace`),
`JARVIS_BRIDGE_INITIAL_SKILLS` (comma-separated skill names), `JARVIS_BRIDGE_ONBOARDING` (opt-in).

## The skill-UI convention

Skills can ship a web UI that the app auto-discovers and surfaces under an "Apps" sidenav group. The
convention is **purely directory-based** — no registration step.

```
<workspace>/
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md
│       └── ui/                # presence of this dir = "has UI"
│           ├── index.html     # required entry point
│           ├── manifest.json  # optional: { displayName, description, icon }
│           └── app.js, styles.css, …
└── .skills-data/
    └── <skill-name>/data.json # persisted state for the skill
```

Skill names must match `/^[a-z0-9][a-z0-9-]*$/` (and a reasonable length cap).

Endpoints (see [03-http-api.md](03-http-api.md)):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/skills` | Discover skills → `{ name, hasUi, displayName, description, icon }`. |
| `GET` | `/skills/:name/ui/*` | Serve files from the skill's `ui/` (path-traversal guarded). |
| `GET` | `/skills/:name/data` | Read `.skills-data/<name>/data.json` (`{}` if absent). |
| `PUT` | `/skills/:name/data` | Atomically replace `data.json` (tmp + rename; body must be a JSON object). |
| `GET` | `/skills/initial` | List template skills in `initial_workspace/skills/`. |
| `POST` | `/skills/sync-to-initial` | Sync workspace skills back into the template (only ones already in the template). |

UI rules:
- The skill UI is loaded into an iframe, so its styles/globals are isolated from the host app.
- Same-origin: `fetch('/skills/<name>/data')` works directly inside the iframe.
- A skill opts into the shared theme with `<link rel="stylesheet" href="/css/skill-ui.css">` (which
  carries the JARVIS tokens — see [05-ui-design-system.md](05-ui-design-system.md)).
- `data.json` is an atomic full-file replace, never a partial merge; the UI should re-read before
  mutating since the agent may have changed it.
