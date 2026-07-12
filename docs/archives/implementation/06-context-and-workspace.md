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

## First-run bootstrap

The workspace is a plain directory created on first run (`fs.mkdir(workspace, { recursive: true })`)
and used as the agent's cwd + the tools' path-traversal root. **There is no context injection**:
the gateway does not prepend any workspace files to agent prompts. The user owns the rest of the
workspace contents and is free to drop notes, code, or anything else there — the agent will see
whatever it finds via its normal tool use.

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
