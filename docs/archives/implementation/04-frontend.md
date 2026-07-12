# 04 — Frontend (Behavior)

The frontend is a **vanilla HTML/CSS/JS single-page app** served statically by Express. No framework,
no build step — plain DOM manipulation + `fetch` + SSE + one WebSocket.

This doc covers **behavior** and is theme-independent: it targets stable DOM IDs so the JARVIS HUD
([05-ui-design-system.md](05-ui-design-system.md)) can be layered on without touching logic. Build
this on a plain dark theme in Phase 4, then repaint in Phase 5.

## Module overview

Modules communicate via `window.*` globals and `CustomEvent`s — **not** ES imports. Load order
matters (dependencies first).

| File | Responsibility |
|---|---|
| `public/index.html` | The single page: sidenav + panels + modals + composer. Stable IDs. |
| `public/css/app.css` | Design system via a `:root` token block (plain in P4, JARVIS in P5). |
| `public/css/skill-ui.css` | Shared theme for iframed skill UIs. |
| `public/js/nav.js` | Hash-based tab router; toast + confirm-modal helpers (`window.JarvisNav`, `window.JarvisToast`, `window.JarvisModal`). |
| `public/js/chat.js` | The big one: chat lifecycle, SSE rendering, sessions, fork/steer/model/approvals, images, onboarding. |
| `public/js/skills.js` | Skills sub-nav discovery + iframe hosting; skills-management page. |
| `public/js/status.js` | "Is the agent busy?" page (in-flight chat streams). |
| `public/js/terminal.js` | Terminal drawer over WebSocket (lazy xterm.js). |
| `public/js/settings.js` | Local preferences (e.g. quick phrases). |
| `public/js/analytics.js` | No-op event-hooks stub (see [08](08-terminal-and-integrations.md)). |
| `public/js/hud.js`, `public/js/holo.js` | **Additive** HUD chrome (Phase 5). |

> The original had a `cron.js` (cron + executions + the tab router). Cron is dropped; keep the tab
> router but move it into a neutral `nav.js`. There is **no** Cron or Executions tab.

### CDN dependencies (loaded via `<script>` / `<link>`, no bundler)

- Behavior: `marked` (markdown), `dompurify` (sanitize), `highlight.js` (code highlighting + a dark
  theme CSS).
- HUD (Phase 5): `three`, `gsap`, and Google Fonts (Orbitron + JetBrains Mono). `xterm.js` is lazily
  loaded by `terminal.js` only when the drawer first opens.

## SPA shell (`index.html`)

`<body>` is a flex row: `<aside class="sidenav">` + `<main>`.

- **Sidenav:** a brand block with a health dot (`#brand-health`), a collapse toggle, and nav groups
  of `<button class="tab" data-tab="...">`:
  - Home → `chat`
  - Apps → `#skills-nav` (hidden until skill UIs are discovered; list in `#skills-nav-list`)
  - Admin → `status`, `skills-manage`, `settings`
- **Main:** one `<section class="panel">` per tab; the router toggles `.active`. Panels:
  `#chat-panel`, `#skills-manage-panel`, `#settings-panel`, `#skill-panel` (just an
  `<iframe id="skill-frame">`), `#status-panel`.
- **Chat panel** (the important markup):
  - `#onboarding-banner`.
  - `.chat-stage` grid: `.chat-stage-main` (transcript + composer) + `#chat-info-panel` (right
    details).
  - **Header** action buttons: `#chat-auto-approve-toggle` (hidden until supported),
    `#chat-follow-toggle`, `#chat-notify-toggle`, `#chat-info-toggle-btn`, `#past-chats-btn`
    ("All Chats"), `#folder-shortcuts-btn`, `#new-chat-btn` (+ `#new-chat-menu`).
  - `#past-chats-menu` (dialog: Chats / Pinned / Groups tabs, list `#past-chats-list`).
  - `#folder-shortcuts-menu` (Bookmarked / Recents + bookmark/pick/open buttons).
  - **Transcript** `#chat` (`role="log"`), flanked by `#chat-scroll-top` / `#chat-scroll-bottom`.
  - **Empty state** as a `<template id="empty-state-template">` (hero + starter prompt cards with
    `data-prompt`).
  - **Composer** `#chat-form`: `#quick-phrases` toolbar, `#chat-attachments` image tray, hidden
    `#chat-image-input`, the `#input` textarea, `#slash-popover`, buttons `#chat-attach` /
    `#chat-steer-send` / `#queue` / `#send`, and a footer with `#chat-form-status` /
    `#chat-form-metrics`.
  - **Right info panel** `#chat-info-panel`: current-chat card (title, group, rename), overview card
    (workspace / branch / model `<select>`), a conversation-outline card, and a collapsible session
    card (session id / pinned / slash-cmd count).
  - **Approval modal** `#approval-modal` (title, `#approval-modal-tool`, `#approval-modal-options`).
- **Global modals/widgets:** `#confirm-modal`, `#open-path-modal`, `#add-phrase-modal`,
  `#toast-stack`, and `#terminal-drawer`.

## Tab router (`nav.js`)

`activateTab(target, { updateHash })` toggles `.tab.active` / `.panel.active`, syncs `location.hash`,
and dispatches lifecycle hooks to the right module (`JarvisSkillsManage.load`, `JarvisSettings.load`,
`JarvisStatus.onTabChange`, `JarvisSkills.onActivate`). Valid tabs plus `skill/<name>` routes. Exposes
`window.JarvisNav.activate/getCurrent`; listens to `hashchange`. Also hosts:
- `window.JarvisToast.push(message, kind, { durationMs })` / `dismiss` — bottom-right stack; errors are
  sticky, success/info auto-dismiss.
- `window.JarvisModal.confirm({ title, message, confirmLabel, cancelLabel, danger })` — promise-based
  themed confirm over `#confirm-modal`.

## The chat client (`chat.js`)

### Endpoints it uses

`GET /chat/init`, `POST /chat/send` (SSE), `POST /chat/cancel`,
`POST /chat/steer`, `POST /chat/approval`, `POST /chat/model`, `POST /chat/auto-approve`,
`GET /chat/sessions`, `PATCH /chat/sessions/:id`, `POST /chat/sessions/fork`, `POST /chat/worktree`,
`POST /chat/pick-folder`, `GET /workspace/branch`, `GET /workspace/status`,
`POST /workspace/complete-onboarding`, `GET /health/agent`.

### The SSE stream + the shared renderer (get this right)

`consumeStream(res, contentEl)` reads `res.body.getReader()`, decodes chunks, splits on `\n`, keeps a
partial line in a buffer, and for each `data:` line `JSON.parse`s a patch. `{type:"done"}` ends the
turn; everything else goes to `applyTimelinePatch(state, patch)` then a scroll-to-bottom.

Each assistant message is backed by a **timeline state** (`createAssistantTimeline(contentEl)`): maps
keyed by tool `index` and `toolCallId`, arg buffers, the current text bubble, the current thought
bubble, and a usage element.

`applyTimelinePatch(state, patch)` is a switch over patch `type`:

- `text-start` → start a fresh prose bubble **seeded with `patch.content`** (the first chunk's text
  rides on `text-start`, not in a delta — do not start an empty buffer); `text-delta` → append
  `patch.delta` and re-render markdown (sanitized).
- `thought-start` (seed with `patch.content`) / `thought-delta` → a collapsible "Thinking…" block.
- `tool-call-start` → break the current text run; insert a `<details>` tool card (running) and seed
  args from `patch.argsInitial`; `tool-call-finalized` → set pretty-printed `args` (an object) + intent.
  (`tool-call-name-delta` / `tool-call-args-delta` are in the union but the ACP backend never emits
  them — keep no-op handlers.)
- `tool-return` (keyed by `toolCallId`, read **`patch.content`**) → add a Return subsection, mark ok;
  `tool-error` (read **`patch.content`**) → Error subsection, mark error, force the details open;
  `tool-return-orphan` → standalone return block from `patch.content`.
- `usage` → render token pills + update `#chat-form-metrics`; `error` → red block (read
  **`patch.message`**) + mark the message `.error`.
- `slash-commands` → refresh the cache + popover; `approval-request` → open the approval modal (carries
  `requestId` + `toolCallId`); `steer-ack` → an accepted/rejected pill; `images-skipped` → a notice
  listing `patch.skipped[]`.

**Transcript rebuild:** `restoreTranscript(entries)` wipes `#chat` and replays history. `user`
entries become bubbles (hiding the internal context-priming and onboarding messages, and skipping the
assistant turn that followed a context-priming message). `assistant` entries are rebuilt by creating
a timeline and replaying their stored `patches[]` through the **same** `applyTimelinePatch`. The live
stream and persisted history therefore share one renderer — implement it once.

### Other subsystems

- **Composer state machine:** flips the primary button between Send / Queue / Stop; shows a mid-stream
  Queue button; manages steer visibility; auto-grows the textarea and publishes the live composer
  height to a CSS variable (`--chat-composer-h`) via a `ResizeObserver`.
- **Smart scroll:** finds the real scroll parent; honors a "Follow chat" toggle (localStorage) and a
  "user scrolled up" guard.
- **Send/queue pipeline:** renders the user bubble (with a "Queued" badge if a turn is in flight),
  queues messages while streaming, drains the queue when idle; `sendMessage` does the
  `POST /chat/send`, manages an `AbortController`, the busy favicon, the fork button, and a completion
  chime.
- **Sessions sidebar:** Chats / Pinned / Groups tabs from `GET /chat/sessions`; pin, inline
  title/group edit, open-in-new-tab; switching sessions aborts any active stream, re-inits, restores
  the transcript, and re-primes context.
- **Fork & steering:** one Fork button on the last finished assistant bubble → `POST /chat/sessions/fork`
  → opens the new session in a new tab; steer text sent from the composer (Ctrl+Enter while streaming).
- **Model picker / auto-approve:** a `<select>` posts `/chat/model`; the toggle posts
  `/chat/auto-approve` (alt-click clears a per-session override).
- **Images:** paste / drag-drop / picker → base64 records → removable thumbnails → sent as
  `images:[{data,mimeType,filename}]`, echoed into the user bubble, viewable in a lightbox. Gated on
  `capabilities.images`.
- **Onboarding / context priming:** check `GET /workspace/status`; if not onboarded, send a hidden
  initial message and auto-complete when identity+user exist; otherwise init, restore transcript, and
  prime context.
- **Capabilities gating:** `capabilities` from `/chat/init` shows/hides features
  (`multipleSessions`, `customWorkingDirectory`, `cancel`, `steer`, `toolApprovals`, `slashCommands`,
  `canFork`, `images`).
- **History/URL:** `sessionId` + `cwd` live in query params; `pushState`/`popstate` give working
  Back/Forward.
- **Notifications/favicon:** Web-Audio "ding"/"chime" for stream-complete and approval; a three-state
  favicon (busy / unread / idle).
- **Globals/events:** exposes `window.JarvisChat.getCwd()`; emits `jarvis:chat-cwd-changed` (terminal
  listens) and consumes `jarvis:quick-phrases-changed` (from settings).

## Skills sub-nav + management (`skills.js`)

- **Sub-nav:** `discover()` calls `GET /skills`, filters `hasUi`, renders
  `<button class="tab skill-tab" data-tab="skill/<name>">` into `#skills-nav-list` (the "Apps" group,
  unhidden when non-empty). `onActivate(name)` points `#skill-frame` at `/skills/<name>/ui/`. The
  router (in `nav.js`) handles `skill/<name>` deep links.
- **Management page:** lists template skills (`GET /skills/initial`) vs workspace skills (`GET /skills`)
  with an "in workspace / missing" badge; a "sync to template" button confirms then
  `POST /skills/sync-to-initial`.

## Status page (`status.js`)

Polls `GET /status/active` **only while the Status tab is active** (pauses on `visibilitychange`).
Renders a busy/idle summary and the list of in-flight `/chat/send` streams (preview / age / session).
Updates the sidebar status pill on every poll.

> Simplified from the original: with cron removed, there is no queue section — just chat streams.
> (`GET /status/active` returns `{ busy, chat: { activeCount, streams } }`.)

## Terminal drawer (`terminal.js`)

Lazy xterm.js. CDN bundles load on first open. Opens
`ws(s)://<host>/terminal?cwd=<JarvisChat.getCwd()>`; `term.onData` → `ws.send(keystrokes)`;
`term.onResize` → `ws.send(JSON {type:"resize",cols,rows})`; incoming JSON control frames vs raw PTY
output. Toggle with Ctrl+` (Cmd+` on macOS) and Esc; width + open-state persisted in localStorage;
re-roots on `jarvis:chat-cwd-changed`. See [08-terminal-and-integrations.md](08-terminal-and-integrations.md).

## Settings (`settings.js`)

Owns local-only preferences (e.g. "quick phrases" stored in localStorage). It is the single writer:
after each change it persists and dispatches `jarvis:quick-phrases-changed` so chat.js re-renders the
pills. No backend calls.

## Additive HUD modules (Phase 5)

These are **purely additive** — they drive new chrome and never touch the behavior modules' logic.
Full spec in [05-ui-design-system.md](05-ui-design-system.md).

- `hud.js`: a GSAP boot reveal, a UTC clock in the top strip, an AGENT health dot polling
  `GET /health/agent`, a decorative coords cycler, a scrolling bottom ticker (mixing fake hex with
  real signal like the active panel id, read from existing globals), a tab-switch dissolve (via event
  delegation on the sidenav), and optional WebAudio bleeps gated by a localStorage flag. Honors
  `prefers-reduced-motion`.
- `holo.js`: a Three.js wireframe + orbit-ring canvas with a bloom pass, idle rotation, pause on
  `visibilitychange`, a single static frame under reduced motion, and a localStorage kill switch.

## Cross-cutting notes for re-implementers

- **Markdown is always sanitized** (marked + DOMPurify with a tight allowlist); highlight.js runs only
  on finished prose code blocks.
- **The SSE patch renderer is shared** by live chat and restored history — one implementation.
- **localStorage keys** (suggested, namespaced `jarvis.*`): `sidebarCollapsed`, `chatInfoCollapsed`,
  `followChat`, `notifySoundEnabled`, `recentFolders`, `bookmarkedFolders`,
  `pastChats.collapsedGroups`, `quickPhrases`, `terminal.width`, `terminal.open`, plus HUD flags
  `hud:sound`, `hud:holo`.
