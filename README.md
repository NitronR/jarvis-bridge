# Jarvis Bridge

A local HTTP/WebSocket gateway that fronts an [ACP](https://agentclientprotocol.com/)-compatible coding agent, exposing chat, tool calls, and a terminal drawer to a React frontend.

## Features

- **Multi-backend support** — run multiple ACP-compatible agents side by side (opencode, Claude Code, etc.) with capability-driven selection
- **Terminal drawer** — embedded WebSocket terminal (Ctrl+`) with xterm.js
- **Chat sessions** — persistent sessions with URL-based resume and message replay from the agent
- **Tool approval** — per-session auto-approve toggle for agent tool calls
- **Quick phrases** — customizable prompt shortcuts
- **Skills management** — view agent skills from the UI (read-only — skill data persistence not yet wired)
- **Usage tracking** — per-session usage meters in the info panel
- **Groups** — organize sessions into named groups
- **Slack integration** — optional `POST /slack/message` endpoint
- **Zero-clone trial** — try it directly with `npx github:NitronR/jarvis-bridge`

## Tech stack

- **Backend:** Node.js >= 22, Express, WebSocket (`ws`), TypeScript, Zod
- **Frontend:** React 18, Vite, xterm.js, CSS Modules
- **Protocol:** [ACP](https://agentclientprotocol.com/) (Agent Client Protocol)

## Getting started

### Prerequisites

Install at least one ACP-compatible backend CLI on your `PATH`:

- **[opencode](https://github.com/opencode-ai/opencode)** — `npm install -g opencode`
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — `npm install -g @anthropic-ai/claude-code`

The setup script auto-detects which backends are installed and configures them automatically. If neither is found, you'll need to hand-edit `~/.jarvis-bridge-system/config/agents.json` before starting.

### Install and run

```bash
git clone https://github.com/NitronR/jarvis-bridge.git
cd jarvis-bridge
npm install
npm run dev
```

`npm install` installs both backend and frontend dependencies (they're an npm workspace)
and automatically runs `scripts/setup.js` (via `postinstall`): it scaffolds
`~/.jarvis-bridge-system/config/agents.json`, pre-filled with any backend CLI it finds on
your `PATH`, and copies `.env.example` to `.env`. Do not run `npm install` inside
`frontend/` directly — dependencies are resolved from the root workspace. Setup never
overwrites files that already exist — re-run it any time with `npm run setup`
(e.g. after installing a new backend CLI).

No local clone? Try it directly:

```bash
npx github:NitronR/jarvis-bridge
```

The npx path lazily builds `dist/` and `public/` on first run, then starts the gateway.
It uses the same auto-setup as `npm install`.

The gateway listens on `http://localhost:3001` by default.

### Convenience script

`start.sh` runs both the backend and frontend dev servers together:

```bash
./start.sh
```

### Production

```bash
npm run build       # compile TypeScript to dist/
npm run build:web   # build frontend SPA to public/
npm start           # run compiled gateway (serves SPA from public/)
```

### Frontend

The React frontend lives in `frontend/`, an npm workspace covered by the root `npm install`:

```bash
npm run dev:web       # start the Vite dev server
npm run build:web     # production build
npm run preview:web   # preview the production build
```

**Keyboard shortcuts**
- `Ctrl+`` ` (Ctrl+backtick) toggles the terminal drawer. It's hidden by default and slides in from the right edge as an overlay.

**Session persistence**
- The active chat session id is kept in the URL as `?sessionId=...`. Reloading the page resumes the same session, including its message history (replayed from the agent — see `docs/acp-notes.md` for how that works under the hood).

## How it works

1. Loads configuration from `.env`.
2. Ensures the workspace directory (`~/.jarvis-bridge`) and system state directory
   (`~/.jarvis-bridge-system`, holding `agents.json`/`settings.json`/`session_metadata.json`)
   exist, creating them if missing.
3. Spawns the ACP agent as a subprocess per the profiles in `agents.json`.
4. Builds a per-cwd backend pool seeded with the default backend.
5. Healthchecks the agent; exits with a hint if it can't connect (e.g. agent needs interactive login).
6. Starts the HTTP gateway and serves the SPA from `public/`.
7. Attaches the WebSocket terminal drawer (unless disabled).
8. Shuts the agent down cleanly on `SIGINT`/`SIGTERM`.

## Configuration

All environment variables are documented in `.env.example`. Key ones:

| Variable | Purpose |
|---|---|
| `JARVIS_BRIDGE_WORKSPACE` | Workspace root / agent cwd (default `~/.jarvis-bridge`) |
| `JARVIS_BRIDGE_SYSTEM_DIR` | State dir for `agents.json`/`settings.json`/`session_metadata.json`, never agent-readable (default `~/.jarvis-bridge-system`) |
| `PORT` | Gateway HTTP port (default `3001`) |
| `JARVIS_BRIDGE_AGENTS_CONFIG` | Path to `agents.json` (default `<systemDir>/config/agents.json`) |
| `JARVIS_BRIDGE_DEFAULT_BACKEND` | Default backend name, seeds `settings.json` on first run |
| `AGENT_AUTO_APPROVE` | Backend-wide default for the auto-approve toggle |
| `JARVIS_BRIDGE_SHELL` | Set `false` to disable the WebSocket terminal drawer |
| `SLACK_BOT_TOKEN` | Enables `POST /slack/message` |
| `JARVIS_BRIDGE_GATEWAY_URL` | Gateway URL used by the optional stdio MCP server |

## API reference

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Gateway health check |
| `/health/agent` | GET | Agent backend health check |
| `/chat/init` | GET | Create or resume a chat session |
| `/chat/send` | POST | Send a message (SSE streaming response) |
| `/chat/stream` | GET | SSE stream for a session |
| `/chat/cancel` | POST | Cancel an active turn |
| `/chat/approval` | POST | Resolve a tool approval request |
| `/chat/elicitation` | POST | Resolve an elicitation request |
| `/chat/steer` | POST | Steer an active turn |
| `/chat/model` | GET/POST | Get or set the active model |
| `/chat/usage` | GET | Query usage totals |
| `/chat/auto-approve` | GET/POST | Get or set auto-approve state |
| `/chat/sessions` | GET | List saved sessions |
| `/chat/sessions/fork` | POST | Fork a session |
| `/chat/sessions/:id` | PATCH | Update session metadata (customTitle, group, pinned) |
| `/chat/sessions/:id` | DELETE | Delete a session |
| `/chat/groups` | GET/POST | List or create session groups |
| `/chat/pick-folder` | POST | Open a native folder picker |
| `/chat/worktree` | POST | Create a git worktree (not yet implemented) |
| `/chat/client-logs` | POST | Submit client-side logs (max 1MB payload) |
| `/status/active` | GET | Active session status |
| `/settings/default-backend` | GET/PUT | Get or set the default backend |
| `/workspace/status` | GET | Workspace git status |
| `/workspace/branch` | GET | Current git branch (returns ok:false when not a git repo) |
| `/tools/execute` | POST | Execute a tool directly |
| `/skills` | GET | List available skills |
| `/skills/:name/ui/*` | GET | Skill UI assets |
| `/skills/:name/data` | GET/PUT | Skill data |
| `/skills/initial` | GET | Initial skill state (stub — returns empty object) |
| `/skills/sync-to-initial` | POST | Sync skills to initial state (stub — no-op) |
| `/slack/message` | POST | Slack bot message relay (stub — returns 503 when SLACK_BOT_TOKEN not set) |
| `/analytics/config` | GET | Analytics config |
| `/analytics/track` | POST | Track an analytics event |
| `/terminal` | WS | WebSocket terminal drawer |

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Run the gateway with `ts-node` |
| `npm run setup` | Re-run backend auto-detect + config scaffolding (also runs automatically on `npm install`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled gateway |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run backend tests (`node --test`) |
| `npm run dev:web` / `build:web` / `preview:web` / `test:web` | Frontend equivalents |
| `./start.sh` | Run both backend and frontend dev servers together |

## Project layout

```
src/
  agent/             ACP agent backend, backend pool, registry, session config
    acp/             ACP transport implementation + JSON-RPC wiring
  tools/             Sandboxed file tools exposed to the agent (read/write, path guard)
  config.ts          Env loading/validation
  index.ts           Entry point (startup sequence — see above)
  logger.ts          Structured logging
  server.ts          HTTP gateway (routes, SSE/WS wiring)
  terminal.ts        WebSocket terminal drawer
  types.ts           Shared TypeScript types
frontend/            React SPA (Vite) — an npm workspace
  src/components/    UI components (ChatPanel, Composer, InfoPanel, TerminalDrawer, etc.)
  src/state/         ChatContext, ToastContext, useChat, useSSE
  src/styles/        Design tokens and global styles
docs/                Design specs, implementation plans, guidelines
  archives/          Historical session summaries and completed-phase notes
scripts/             Setup automation (auto-detect backends, scaffold config)
bin/                 npx entry point (jarvis-bridge.js)
```

The `public/` directory is **100% generated** by `npm run build:web` (Vite
`outDir: "../public"`) — it's gitignored and never hand-edited. A plain
`npm install` leaves a working build in place via `postinstall`.

## Security

- `~/.jarvis-bridge-system/` (config, settings, session metadata) is a **sibling** of the
  agent's workspace, never nested under it — keeping backend spawn commands and secrets
  outside the agent's sandboxed file tools.
- File tools (`src/tools/`) are sandboxed to the workspace root via `pathGuard`, which
  resolves symlinks before checking containment.
- `.env` and `agents.json` may contain secrets — never commit them.
- Per-session API traffic logs (`.logs/`) would contain prompt text and file contents —
  treat them like `.env` when wired up.

## Troubleshooting

- **Agent healthcheck fails on startup** — the agent CLI may need a pre-authenticated
  login. Run it once in a terminal (e.g. `claude login` for Claude) then retry.
- **`npm run dev:web` can't reach the backend** — the Vite dev server proxies
  `/chat`, `/health`, `/terminal`, etc. to `localhost:3001`. Ensure the backend
  is running (`npm run dev`).
- **npx install fails to build the frontend** — frontend build-time dependencies
  (`vite`, `typescript`, etc.) must be in root `package.json`'s `dependencies`,
  not `devDependencies` (npm skips `devDependencies` when installing as a dependency).

## Docs

See `docs/` for design specs and implementation plans, `docs/acp-notes.md` for ACP backend implementation quirks, and `docs/archives/` for historical/completed work.
