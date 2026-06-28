# 09 — Config & Setup

## Project structure

```
jarvis-bridge/
├── package.json
├── tsconfig.json
├── .env.example
├── start.sh / stop.sh            # optional multi-instance launchers
├── initial_workspace/            # template copied into a fresh workspace
│   ├── IDENTITY.md, SOUL.md, USER.md, AGENTS.md, MEMORY.md, TOOLS.md, HEARTBEAT.md
│   └── skills/<name>/...          # template skills (optional)
├── public/                       # static SPA (served as-is)
│   ├── index.html
│   ├── css/{app.css, hud.css, skill-ui.css}
│   ├── js/{nav.js, chat.js, skills.js, status.js, terminal.js, settings.js, analytics.js, hud.js, holo.js}
│   └── favicon*.svg
└── src/
    ├── index.ts                  # entry point
    ├── config.ts                 # env -> typed config
    ├── server.ts                 # Express app + all routes
    ├── types.ts                  # tool param/result types
    ├── terminal.ts               # WS + node-pty drawer
    ├── mcp-server.ts             # optional stdio MCP server
    ├── agent/
    │   ├── types.ts              # AgentBackend / AgentSession / ChatPatch / ...
    │   ├── index.ts              # createAgentBackend factory
    │   ├── backendPool.ts        # per-cwd pool
    │   └── acp/
    │       ├── index.ts, jsonrpc.ts, mapping.ts, prompt-content.ts, image-resize.ts
    ├── context/index.ts
    ├── tools/{index.ts, readFile.ts, writeFile.ts}
    ├── workspace/bootstrap.ts
    ├── slack/postMessage.ts      # optional
    └── types/pngjs.d.ts          # local type shim for pngjs
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "ts-node": { "files": true },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## package.json (scripts + deps)

```jsonc
{
  "name": "jarvis-bridge",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "mcp": "ts-node src/mcp-server.ts"      // optional
  },
  "dependencies": {
    "express": "^4",
    "zod": "^4",
    "ws": "^8",
    "node-pty": "^1",
    "jpeg-js": "^0.4",   // pure-JS JPEG codec for image resizing
    "pngjs": "^7",       // pure-JS PNG codec for image resizing
    "dotenv": "^17",
    "@modelcontextprotocol/sdk": "^1"  // optional, only for the MCP server
  },
  "devDependencies": {
    "typescript": "^5",
    "ts-node": "^10",
    "@types/express": "^4",
    "@types/node": "^22",
    "@types/ws": "^8"
  },
  "engines": { "node": ">=20" }
}
```

### Dependency rationale

| Dep | Why |
|---|---|
| `express` | HTTP + static file serving + SSE. |
| `zod` | Request-body validation at the HTTP boundary. |
| `ws` + `node-pty` | The terminal drawer. |
| `jpeg-js` + `pngjs` | Pure-JS image downscaling (no native build) for prompt image attachments. |
| `dotenv` | Load `.env` in dev. |
| `@modelcontextprotocol/sdk` | Only for the optional MCP server. |

**Frontend libs are CDN-only (no bundler):** `marked`, `dompurify`, `highlight.js` (behavior); and
`three`, `gsap`, Google Fonts (HUD). `xterm.js` is lazy-loaded by the terminal drawer.

> The original also depended on `node-cron` + `cron-parser` (cron) and a voice/analytics client —
> all **dropped** here.

## Environment variables

All names are arbitrary; rename to taste. Defaults shown.

| Var | Default | Purpose |
|---|---|---|
| `JARVIS_BRIDGE_WORKSPACE` | `~/.jarvis-bridge` | Workspace root (created if missing). |
| `PORT` | `3001` | Gateway HTTP port. |
| `AGENT_CMD` | `<agent-cli>` | The agent CLI binary (absolute path if not on `PATH`). |
| `AGENT_ARGS` | `<run subcommand>` | Whitespace-split args to start the ACP agent over stdio. |
| `AGENT_MODEL` | _unset_ | Optional model pin via `session/set_model` for new sessions. |
| `AGENT_AUTO_APPROVE` | `false` | Backend-wide default for the Auto-approve toggle (opt-in: only literal `"true"` enables). |
| `INJECT_CONTEXT` | `true` | Enable context injection (anything but `"false"`). |
| `INJECT_CONTEXT_MODE` | `paths` | `paths` (catalog) or `full` (inline file contents). |
| `INITIAL_WORKSPACE_PATH` | `./initial_workspace` | Template source dir. |
| `JARVIS_BRIDGE_INITIAL_SKILLS` | _unset_ | Comma-separated skill names to install on first run. |
| `JARVIS_BRIDGE_ONBOARDING` | `false` | Opt into the first-run onboarding conversation. |
| `JARVIS_BRIDGE_SHELL` | `true` | Enable the terminal drawer (set `false` to disable). |
| `SLACK_BOT_TOKEN` | _unset_ | Optional Slack bot token (`xoxb-...`) for `POST /slack/message`. |
| `JARVIS_BRIDGE_GATEWAY_URL` | `http://localhost:3001` | Gateway URL for the optional stdio MCP server. |

> Agent auth: the ACP agent CLI is responsible for its own authentication (it manages tokens inside
> the subprocess). If the agent fails to start, the most common cause is an unauthenticated CLI —
> surface a clear hint on startup-healthcheck failure pointing at the agent's login command.

## Running

```bash
# dev (ts-node, no build)
cp .env.example .env   # then set AGENT_CMD / AGENT_ARGS for your agent CLI
npm install
npm run dev            # http://localhost:3001

# production
npm run build && npm start
```

### Startup sequence (`src/index.ts`)

1. `ensureWorkspaceReady(workspace, initialWorkspacePath, initialSkills)`.
2. Create the chat backend via `createAgentBackend("chat", cfg, { workspace })`; apply the
   auto-approve default.
3. Create the per-cwd backend pool (seeded with the default backend; per-cwd backends pin their log
   dir to the canonical workspace).
4. `healthcheck()` the backend; on failure print an actionable hint (likely agent auth) and exit.
5. `createServer(...)` and `attachTerminalServer(...)`.

### Multi-instance (optional `start.sh`)

Support named instances, each with its own workspace (`~/.jarvis-bridge-<name>`) and an
auto-assigned port, so several can run side by side. Keep a PID file per instance for `stop.sh`.

## Re-implementation checklist (build order)

Follow [00-execution-phases.md](00-execution-phases.md). Quick gate per phase:

- [ ] **P0** `npm run dev` serves `public/` and exits cleanly.
- [ ] **P1** Empty workspace gets populated from the template; `buildContext` works in both modes.
- [ ] **P2** A script can create a session, stream a turn (text + tool call + usage), cancel, and
      healthcheck.
- [ ] **P3** `curl` `/chat/init` returns a session; raw SSE `POST /chat/send` streams patches ending
      in `{"type":"done"}`; `/tools/execute` reads a workspace file.
- [ ] **P4** Full chat UX on a plain theme: streaming, approvals, sessions, fork, images, terminal.
- [ ] **P5** JARVIS HUD applied; every P4 flow still works; reduced-motion clean.
- [ ] **P6** Optional MCP / Slack / event-hooks wired; `npm run build` is type-clean.
