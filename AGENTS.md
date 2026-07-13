# AGENTS.md

Jarvis Bridge: a local HTTP/WebSocket gateway (Node/TypeScript, Express + `ws`) that fronts
an ACP-compatible coding agent subprocess, exposing chat, tool calls, and a terminal drawer
to a React (Vite) frontend in `frontend/`.

## Build & test

Backend (repo root):
```
npm run dev          # ts-node src/index.ts
npm run build         # tsc -> dist/
npm run typecheck     # tsc --noEmit
npm test              # node --test over src/**/*.test.ts (TS_NODE_TRANSPILE_ONLY=true)
```
Run a single backend test file: `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test src/agent/acp/index.test.ts`

Frontend (`frontend/`, separate npm workspace — not an npm workspaces link, just a subdir with its own `package.json`):
```
npm run dev:web        # or: cd frontend && npm run dev
npm run build:web
npm run test:web        # vitest --run
```
Run a single frontend test: `cd frontend && npx vitest run src/path/to/File.test.tsx`

## Backend configuration

Multiple named agent backends can run side by side — `opencode` and Claude (via
`@agentclientprotocol/claude-agent-acp`) ship by default. Backend selection is
capability-driven (`AgentCapabilities` in `src/agent/types.ts`), never a hardcoded
`kind` branch in shared code (`src/server.ts`, `src/agent/acp/mapping.ts`).

- `agents.json` (copy from `agents.json.example`; gitignored) lists named backend
  profiles: `{ name, kind, command, args, env }`. `src/agent/backendConfig.ts` loads it.
- `settings.json` (gitignored, runtime-writable) holds the user's default-backend
  override, settable via `GET/PUT /settings/default-backend`.
- `session_metadata.json` (gitignored, in the workspace dir) persists auto-approve
  state (backend-wide default + per-session overrides) and session metadata
  (`customTitle`/`pinned`/`group`) via `src/agent/sessionConfigStore.ts`
  (`createSessionConfigStore`). It must be constructed in `src/index.ts` and passed
  as `sessionConfig` into `createServer` — without that wiring, `/chat/auto-approve`
  and `PATCH /chat/sessions/:id` still work for the life of the process but silently
  stop persisting across gateway restarts (this happened for one release; see
  `docs/archives/2026-07-13-auto-approve-persistence-fix.md`).
- `src/agent/backendRegistry.ts` composes one `BackendPool` (`src/agent/backendPool.ts`)
  per profile — lazy-spawns non-default backends on first use, eagerly spawns the
  default at startup.
- Resuming a session (`GET /chat/init?sessionId=...`) always routes to the backend that
  created it (via `registry.findSession()`), never the current default — changing the
  default backend must not migrate existing sessions. See `docs/acp-notes.md` for the
  cross-server-restart caveat.
- `GET /chat/init` also accepts `cwd`/`backend`/`model` (no `sessionId`) to create a fresh
  session pinned to a specific workspace/backend/model — used by the "+ New" button's
  cmd/ctrl-click-to-open-in-a-new-tab behavior (`openNewChatInNewTab` in `useChat.ts`).
  These are a one-shot handoff: the frontend strips them from the URL once consumed, so
  reloading that tab later falls back to plain `sessionId` resume.
- See `docs/agent-claude-code.md` for the Claude-specific binding profile (spawn
  resolution, auth model, known wire-shape gotchas confirmed via live probe) and
  `docs/claude-acp-future-phases.md` for what's intentionally deferred.
- Per-session API (JSON-RPC) traffic logging (`.logs/<sessionId>.log`, one JSONL entry
  per request/response/notification) is hooked in generically at `AcpConnection` in
  `src/agent/acp/jsonrpc.ts` (see `src/agent/acp/apiLog.ts`) rather than at individual
  call sites, so it can't miss a method. Controlled by `JARVIS_BRIDGE_API_LOGS` (default
  on) / `JARVIS_BRIDGE_API_LOGS_DIR` (default `.logs`, gitignored). Traffic that can't be
  attributed to a sessionId (e.g. `initialize`) goes to `.logs/_unscoped.log`.

## Code style

- TypeScript `strict: true`. Backend compiles to CommonJS; frontend is ESM (Vite).
- No ESLint/Prettier configured — `tsc --noEmit` is the only enforced gate. Match surrounding
  file style rather than reformatting.
- Backend tests use Node's built-in `node:test` + `assert`, not a third-party test runner.
- Frontend tests use Vitest + Testing Library.

## Security / boundaries

- **Never** commit `.env` or log its contents — see `.env.example` for the documented variable
  list (`JARVIS_BRIDGE_DEFAULT_BACKEND`, `SLACK_BOT_TOKEN`, etc.). `.env*` and `agents.json`/
  `settings.json` are gitignored except the `.example` templates.
- File tools (`src/tools/readFile.ts`, `writeFile.ts`) are sandboxed to the workspace root via
  `src/tools/pathGuard.ts`, which resolves symlinks before checking containment. **Don't**
  weaken or bypass this guard when adding new file-touching tools — add the new tool through
  the same guard, don't reimplement path checks inline.
- `JARVIS_BRIDGE_WORKSPACE` (default `~/.jarvis-bridge`) is the agent's sandboxed cwd; treat
  paths outside it as untrusted targets.
- Ask first before adding a new external integration surface (new HTTP route class, new token
  type) — these expand the gateway's attack surface beyond the current chat/terminal/Slack set.
- `.logs/*.log` (per-session API traffic logs) contain raw request/response payloads —
  prompt text, file contents, tool args/output. Treat them like `.env`: never commit,
  never paste into issues/PRs, and be careful before sharing them for debugging.

## Commit guidelines

- Conventional-ish format: `type(scope): summary` or `type: summary` (e.g.
  `feat(frontend): <Composer> — textarea + attachments`, `fix: acp empty-reply on session/load`).
  Imperative, present tense. Scope is optional but common for frontend component work.

## Don't-touch / read-first zones

- `src/agent/acp/index.ts` (`AcpAgentBackend`) session lifecycle: `session/load` replay has a
  non-obvious ordering requirement (session must be registered in `this.sessions` *before* the
  request is sent, or replay notifications are silently dropped) and replay capture must append
  real `ChatPatch[]`, not placeholders. Read `docs/acp-notes.md` in full before modifying session
  load, replay, or `handleSessionUpdate()`.
- `docs/archives/` is historical record (session summaries, completed-phase notes) — don't edit
  after the fact; add new dated files instead of amending old ones.
