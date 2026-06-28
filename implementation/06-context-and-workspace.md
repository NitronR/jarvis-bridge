# 06 — Context Injection & Workspace

Jarvis Bridge keeps all agent state in a single **workspace** directory. On first run it lays down a
template; before each chat turn it can prepend a **context** block built from the workspace files.

## Workspace location & layout

Default `~/.jarvis-bridge` (override with `JARVIS_BRIDGE_WORKSPACE`). The workspace is a plain
directory created on first run (`fs.mkdir(..., { recursive: true })`) and used as:

1. The default `cwd` passed to the ACP agent when it spawns a session.
2. The realpath root for the workspace-scoped `read_file` / `write_file` tools (path-traversal
   guard).
3. An optional read source for `src/context/index.ts:buildContext` — the user can place any files
   they want prepended to agent turns. No template is copied on first run.

```
<workspace>/                   # plain directory, user-owned
├── (whatever the user puts here)
└── .jarvis-bridge/
    ├── chat-session-metadata.json # UI-side per-session metadata (title/pinned/group/cwd)
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

## First-run bootstrap

There is **no template copy** and **no onboarding flow**. The gateway does only:

- `fs.mkdir(workspace, { recursive: true })` — create the workspace dir if missing.
- `fs.mkdir(<workspace>/.jarvis-bridge, { recursive: true })` — create the metadata dir the
  gateway writes to (session metadata + agent stderr logs).

The user owns the rest of the workspace contents. If they want context injection to find files,
they put them there.

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
