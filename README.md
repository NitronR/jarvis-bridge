# Jarvis Bridge

A local HTTP/WebSocket gateway that fronts an [ACP](https://agentclientprotocol.com/)-compatible coding agent, exposing chat, tool calls, and a terminal drawer to a React frontend.

## How it works

1. Loads configuration from `.env`.
2. Ensures the workspace directory exists (this becomes the agent's default cwd).
3. Spawns the ACP agent as a subprocess (or falls back to a stub backend if `AGENT_CMD` is unset).
4. Builds a per-cwd backend pool seeded with the default backend.
5. Healthchecks the agent; exits with a hint if it can't connect (e.g. agent needs interactive login).
6. Starts the HTTP gateway and serves the SPA from `public/`.
7. Attaches the WebSocket terminal drawer (unless disabled).
8. Shuts the agent down cleanly on `SIGINT`/`SIGTERM`.

## Getting started

```bash
npm install
cp .env.example .env   # then edit AGENT_CMD / AGENT_ARGS etc.
npm run dev
```

The gateway listens on `http://localhost:3001` by default.

### Frontend

The React frontend lives in `frontend/` and is a separate npm workspace:

```bash
npm run dev:web       # start the Vite dev server
npm run build:web     # production build
npm run preview:web   # preview the production build
```

**Keyboard shortcuts**
- `Ctrl+`` ` (Ctrl+backtick) toggles the terminal drawer. It's hidden by default and slides in from the right edge as an overlay.

**Session persistence**
- The active chat session id is kept in the URL as `?sessionId=...`. Reloading the page resumes the same session, including its message history (replayed from the agent — see `docs/acp-notes.md` for how that works under the hood).

## Configuration

All environment variables are documented in `.env.example`. Key ones:

| Variable | Purpose |
|---|---|
| `JARVIS_BRIDGE_WORKSPACE` | Workspace root / agent cwd (default `~/.jarvis-bridge`) |
| `PORT` | Gateway HTTP port (default `3001`) |
| `AGENT_CMD` / `AGENT_ARGS` | Command and args used to launch the ACP agent over stdio |
| `AGENT_MODEL` | Optional model pin applied to new sessions |
| `AGENT_AUTO_APPROVE` | Backend-wide default for the auto-approve toggle |
| `JARVIS_BRIDGE_SHELL` | Set `false` to disable the WebSocket terminal drawer |
| `SLACK_BOT_TOKEN` | Enables `POST /slack/message` |
| `JARVIS_BRIDGE_GATEWAY_URL` | Gateway URL used by the optional stdio MCP server |

If `AGENT_CMD` is left empty, the gateway runs against an in-memory stub backend so the frontend can be developed without a real agent.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Run the gateway with `ts-node` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled gateway |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run backend tests (`node --test`) |
| `npm run dev:web` / `build:web` / `preview:web` / `test:web` | Frontend equivalents |

## Project layout

```
src/
  agent/       ACP agent backend + per-cwd backend pool
  tools/       Sandboxed file tools exposed to the agent (read/write, path guard)
  terminal.ts  WebSocket terminal drawer
  server.ts    HTTP gateway (routes, SSE/WS wiring)
  config.ts    Env loading/validation
  index.ts     Entry point (see startup sequence above)
frontend/      React SPA (Vite)
docs/          Design specs and implementation plans (see docs/archives/ for history)
```

## Docs

See `docs/` for design specs and implementation plans, `docs/acp-notes.md` for ACP backend implementation quirks, and `docs/archives/` for historical/completed work.
