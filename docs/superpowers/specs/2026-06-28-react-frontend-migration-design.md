# 2026-06-28 — React + Vite frontend migration (design)

Status: draft, awaiting plannotator review.

## Context

The current SPA at `public/` is **vanilla HTML/CSS/JS**: 7 IIFE modules
publishing `window.JarvisX` globals, no build step, no type checking.
The chat module (`public/js/chat.js`) is the largest file (~700 lines) and
is already feeling the weight — it mixes networking, state, SSE parsing,
DOM rendering, and form handling in one closure.

The user has decided to migrate the frontend to a real framework. Choices
locked in this session:

| Decision | Choice |
|---|---|
| Framework | **React 18 + TypeScript + Vite** |
| State | `useState` + Context + custom hooks (no external state lib) |
| Routing | Custom hash router (~20 lines) |
| Styling | CSS Modules + keep `:root` design tokens |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-sanitize` |
| Project location | New Vite project at `frontend/` |
| Dev workflow | Two terminals — backend `:3001`, Vite `:5173` (proxies API) |

The Phase 4 behavioral semantics (which endpoints are called, what the SSE
patches mean, the chat lifecycle) do **not** change. The migration is a
front-end rewrite, not a product change.

## Architecture

**Backend (unchanged).** `src/server.ts` (Express) keeps serving the same
endpoints — `/chat/init`, `/chat/send` (SSE), `/chat/cancel`,
`/chat/approval`, `/chat/steer`, `/chat/model`, `/chat/auto-approve`,
`/chat/sessions`, `/chat/sessions/fork`, `PATCH /chat/sessions/:id`,
`/tools/execute`, `/health`, `/health/agent`, `/status/active`,
`/workspace/status`, `/skills`, `/slack/message`, `/analytics/*`. The
server-side SPA-asset serving is also unchanged: `app.use(express.static("public"))`.

**Frontend (rewritten).** A new Vite project at `frontend/` produces a
static build output written to `public/`. Express serves `public/` as it
does today — no Express changes.

**Dev workflow.**

```
terminal 1:  npm run dev          # ts-node src/index.ts, port 3001
terminal 2:  npm run dev:web      # cd frontend && npm run dev, port 5173
```

Vite proxies `/chat`, `/health`, `/status`, `/workspace`, `/skills`,
`/slack`, `/analytics`, `/tools` to `:3001`. The browser only ever talks
to `:5173` during development.

## File layout

```
jarvis_bridge/
├── package.json                # adds: react, react-dom; dev: vite, @vitejs/plugin-react,
│                               #       vitest, @testing-library/react, jsdom, types
├── vite.config.ts              # NOT at repo root — lives in frontend/, see §"Vite config"
├── frontend/                   # Vite project root
│   ├── index.html              # Vite entry; <script type="module" src="/src/main.tsx">
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── package.json (optional — can use root)
│   ├── src/
│   │   ├── main.tsx            # createRoot(document.getElementById("root")!).render(<App/>)
│   │   ├── App.tsx             # HashRouter + ChatProvider + ToastProvider + <Sidenav/> + <main>
│   │   ├── routes.ts           # ROUTES const + Route type + parseHash
│   │   ├── useHashRoute.ts     # hook: { route, navigate } listening to hashchange + popstate
│   │   ├── api/
│   │   │   ├── client.ts       # fetchJSON, fetchSSE — typed wrappers around fetch()
│   │   │   └── types.ts        # ChatPatch union, AgentCapabilities, SessionModelsInfo, …
│   │   ├── state/
│   │   │   ├── ChatContext.tsx # context: session, capabilities, busy, models, autoApprove,
│   │   │   │                   #         slashCommands, title; exposes actions via provider
│   │   │   ├── useChat.ts      # hook: init / sendMessage / cancel / steer / fork /
│   │   │   │                   #       switchSession / setModel / setAutoApprove
│   │   │   ├── useSSE.ts       # hook: POST + consume text/event-stream; calls onPatch / onDone
│   │   │   ├── ToastContext.tsx # toast queue (push / dismiss)
│   │   │   └── HealthDot.tsx    # polls /health/agent, drives brand dot class
│   │   ├── markdown.tsx        # <Markdown source={…}/> wrapper using react-markdown +
│   │   │                       #   remark-gfm + rehype-sanitize; renders inside Message bubbles
│   │   ├── components/
│   │   │   ├── Sidenav.tsx                + .module.css
│   │   │   ├── ChatPanel.tsx              + .module.css   # owns Transcript + Composer + InfoPanel
│   │   │   ├── Transcript.tsx             + .module.css   # scrollable list of <Message>
│   │   │   ├── Message.tsx                + .module.css   # one bubble (user or assistant)
│   │   │   ├── Timeline.tsx               + .module.css   # the big patch→DOM renderer (shared live + replay)
│   │   │   ├── Composer.tsx               + .module.css   # textarea + attachments + send/queue/cancel/steer
│   │   │   ├── InfoPanel.tsx              + .module.css   # right column: rename/group/pinned/model/session
│   │   │   ├── ApprovalModal.tsx          + .module.css
│   │   │   ├── PastChatsMenu.tsx          + .module.css
│   │   │   ├── StatusPanel.tsx            + .module.css
│   │   │   ├── SettingsPanel.tsx          + .module.css   # quick phrases (localStorage)
│   │   │   ├── SkillsManagePanel.tsx      + .module.css
│   │   │   ├── SkillPanel.tsx             + .module.css   # iframe wrapper
│   │   │   ├── TerminalDrawer.tsx         + .module.css   # drawer stub — backend WS still deferred
│   │   │   └── Toasts.tsx                 + .module.css   # provider + render stack
│   │   └── test-setup.ts      # jsdom polyfills (TextEncoder/TextDecoder/matchMedia) + jest-dom
│   └── tests/                 # cross-component integration tests (optional)
└── public/                     # Vite build output (was the hand-written SPA)
```

## State + data flow

```tsx
// state/ChatContext.tsx — top-level provider
type ChatState = {
  sessionId: string | null;
  cwd: string | null;
  capabilities: AgentCapabilities | null;
  slashCommands: SlashCommand[];
  models: ModelInfo[];
  currentModel: string | null;
  autoApprove: { default: boolean; override: boolean | null; effective: boolean };
  busy: boolean;
  title: string;
  transcript: ChatMessage[];   // [{role:"user",text,images?}, {role:"assistant",patches:[]}]
  steerEnabled: boolean;
};
```

```tsx
// state/useChat.ts — the primary hook used by ChatPanel
const {
  state,
  send, cancel, sendSteer,
  switchSession, forkCurrent, startNewChat,
  setModel, setAutoApprove, toggleSteer,
  attachImage, removeAttachment,
  resolveApproval, renameSession, setGroup, setPinned,
} = useChat();
```

```tsx
// state/useSSE.ts — primitive consumed by useChat.send
function useSSE(opts: {
  url: string;
  body: object;
  enabled: boolean;
  onPatch: (p: ChatPatch) => void;
  onDone: () => void;
  onError: (e: Error) => void;
}): { start: () => void; abort: () => void; busy: boolean };
```

The hook owns the `AbortController`. `cancel()` aborts the stream AND
posts `/chat/cancel` so the backend shuts down cleanly.

## Routing

```ts
// routes.ts
export const ROUTES = ['chat', 'status', 'skills-manage', 'settings'] as const;
export type Route = (typeof ROUTES)[number] | `skill/${string}`;
```

```ts
// useHashRoute.ts — ~30 lines
export function useHashRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setRoute] = useState<Route>(parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);
  const navigate = useCallback((r: Route) => {
    const next = r === 'chat' ? '#' : `#${r}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, []);
  return { route, navigate };
}
```

App.tsx switches on `route`. `skill/<name>` mounts `<SkillPanel name=…/>`
which sets `<iframe src="/skills/<name>/ui/">`.

## Timeline renderer

`components/Timeline.tsx` is the patch→DOM translator (the biggest and
most-tested component). It's a pure function of `ChatPatch[]` to a React
element tree. Used both:

- **Live streaming:** `useChat.send()` calls `useSSE`, which feeds
  patches into a `patches: ChatPatch[]` accumulator on the current
  assistant message; `Timeline` renders incrementally.
- **History replay:** when `switchSession()` returns a session with
  replay history, `useChat` feeds the stored patches through the same
  `Timeline`.

State machine (ported from the current `chat.js`, no semantic change):

| Patch type | Render |
|---|---|
| `text-start` | seed markdown bubble with `content` |
| `text-delta` | append `delta`; re-render `<Markdown source=…>` |
| `thought-start` / `thought-delta` | collapsible "Thinking…" block |
| `tool-call-start` | `<details>` tool card; seed args |
| `tool-call-finalized` | pretty-print args; add intent to summary |
| `tool-return` / `tool-error` | return subsection; ok / error styling |
| `usage` | token pills + composer metrics |
| `error` | red block; mark message `.error` |
| `slash-commands` | refresh context; rebuild slash popover |
| `approval-request` | open `<ApprovalModal requestId toolName options>` |
| `steer-ack` / `images-skipped` | toast |
| `done` | mark finished |

## Styling

Each component folder contains a `.module.css` next to its `.tsx`. The
existing `:root` token block (from `public/css/app.css` in the vanilla
build, soon from `frontend/src/styles/tokens.css`) is imported once in
`main.tsx` and provides CSS variables consumed by every module. Token
**names** stay unchanged so Phase 5's JARVIS HUD repaint still works.

Per-component scoping eliminates class-name collisions; the global
stylesheet stays small (just the tokens + body reset + scrollbar).

## Markdown

`markdown.tsx` exports a `<Markdown source={string}/>` component built on
`react-markdown` with `remark-gfm` (tables, strikethrough, task lists)
and `rehype-sanitize` (default schema — strips `<script>`, `<iframe>`,
event handlers, javascript: URLs). Code blocks render as `<pre><code>`
with no syntax highlighting (kept simple for MVP; `react-syntax-highlighter`
can be added later if needed).

## Vite config

```ts
// frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',     // write build output into repo's public/
    emptyOutDir: true,       // wipe the vanilla SPA before each build
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/chat': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
      '/status': 'http://localhost:3001',
      '/workspace': 'http://localhost:3001',
      '/skills': 'http://localhost:3001',
      '/slack': 'http://localhost:3001',
      '/analytics': 'http://localhost:3001',
      '/tools': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

Vite is invoked from `frontend/`. Build output lands in `../public/`.

## New dependencies

Runtime (added to root `package.json`):

```
react          ^18
react-dom      ^18
react-markdown ^9
remark-gfm     ^4
rehype-sanitize ^6
```

Dev (also root):

```
vite                       ^5
@vitejs/plugin-react       ^4
vitest                     ^2
@testing-library/react     ^16
@testing-library/jest-dom  ^6
jsdom                      ^25
@types/react               ^18
@types/react-dom           ^18
```

## Migration / deletion

- Delete `public/index.html`, `public/css/`, `public/js/`.
- Keep `public/` — it becomes the Vite build output dir.
- Keep `src/server.ts` and all backend code unchanged.
- The existing `src/server.test.ts` SPA-asset tests
  (`GET / serves the SPA index.html`, etc.) need updating: Vite's
  production output puts `index.html` at the root with hashed asset
  filenames (`/assets/index-abc123.js`). The tests should still pass for
  `/` returning 200 + HTML containing `<div id="root">` and the asset
  tags. We keep them; only the assertions change.
- The vanilla archive recap at `docs/archives/2026-06-28-p2-acp-backend.md`
  is not affected.

## Testing

- **Component tests (new):** Vitest + `@testing-library/react`. Each
  component gets `Component.test.tsx` next to it. Assertions use
  `jest-dom` matchers (`toBeInTheDocument`, `toHaveTextContent`, etc).
- **Hook tests:** `@testing-library/react`'s `renderHook` for `useSSE`,
  `useChat`. SSE is mocked with a `ReadableStream` of fake `data: …`
  lines fed through `new Response(stream).body`.
- **Server tests (kept):** the existing `src/server.test.ts` Node `--test`
  suite is unchanged in spirit; only the SPA-asset assertions are tweaked.
- **Smoke:** the live `curl /` + `curl /chat/send` SSE flow continues to
  work — Vite-built HTML is served identically to vanilla HTML by
  `express.static`.

## Out of scope (deferred)

- **Terminal drawer backend.** `TerminalDrawer.tsx` opens the drawer and
  shows a placeholder; the WebSocket-backed PTY at `/terminal` is still
  a follow-up. Same scope as in Phase 4.
- **Syntax-highlighted code blocks.** MVP renders `<pre><code>` plain.
  `react-syntax-highlighter` can be added later if/when chat shows
  enough code.
- **Phase 5 (JARVIS HUD).** Separate work — repaints the `:root` tokens
  + adds `hud.css` + `hud.js` + `holo.js`. Not affected by this
  migration.

## Open risks

1. **SSE hook flakiness.** `useSSE` has to handle `AbortController`,
   partial lines, malformed JSON, network drops, and the synthesized
   `{"type":"done"}` if the stream ends without one. The vanilla
   `chat.js` already handles all these; the React port has to keep that
   discipline. Mitigated by hook tests using a mocked `ReadableStream`.
2. **Sidenav flicker on hash route.** The current vanilla code toggles
   `.active` class. In React we mount/unmount panels. The CSS targets
   `.panel.active` so we keep that contract — only one panel is visible
   at a time. If we want panel transitions later (Phase 5), we add CSS
   classes for `enter`/`exit` and the panels stay mounted for one
   frame.
3. **Vite `emptyOutDir: true` + server crash on `public/` write.** If the
   dev server is running while `vite build` runs, files may be in
   flight. Solution: only run `vite build` for production; in dev we use
   `vite` (the dev server) directly which doesn't touch `public/`.

## Validation pass (what "done" looks like)

- [ ] `npm run dev` starts the backend on `:3001`; `cd frontend && npm run dev`
      starts Vite on `:5173`; browser at `:5173` shows the chat UI with the
      session, slash commands, and models populated by the real backend.
- [ ] Sending a message streams SSE patches and renders text + tool cards
      + usage pills.
- [ ] Clicking a tool-call approval option calls `/chat/approval` and the
      tool result lands in the transcript.
- [ ] Switching sessions, forking, attaching an image, opening the terminal
      drawer all work end-to-end.
- [ ] `npm run build` (which runs `vite build` + `tsc`) produces a clean
      production build with no TypeScript errors.
- [ ] `npm test` (vitest) passes; existing `npm test` (node:test) for the
      backend continues to pass.
- [ ] The vanilla `public/index.html` / `public/js/*.js` / `public/css/`
      are gone; only the Vite-built artifacts remain in `public/`.

## Approval

This doc is the result of one round of brainstorming on 2026-06-28.
Awaiting plannotator review by the user before invoking writing-plans.
