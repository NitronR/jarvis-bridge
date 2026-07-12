# 08 — Terminal & Integrations

This covers the in-browser terminal drawer, the optional Slack helper, and the generic event-hooks
seam. (Voice/STT and cron are out of scope.)

## Terminal drawer — `src/terminal.ts`

An in-browser terminal over WebSocket + `node-pty`. The frontend side is in
[04-frontend.md](04-frontend.md) (`terminal.js`, lazy xterm.js).

### Wiring

```ts
function attachTerminalServer(opts: { server: http.Server; workspace: string; enabled: boolean }): void;
```

- Attach a `WebSocketServer({ noServer: true })` to the HTTP server's `upgrade` event, handling only
  URLs starting with `/terminal`.
- If `enabled` is false, write a `403` and destroy the socket (the UI surfaces "shell disabled").

### Per-connection

- Resolve cwd from `?cwd=<path>` (only if it resolves to an existing directory; else fall back to the
  workspace).
- Pick a shell: Windows → `COMSPEC` or `cmd.exe`; otherwise `$SHELL` (or `/bin/bash`) with `-l` to
  source the login profile.
- Spawn a PTY (`xterm-256color`, 80×24) inheriting `process.env` plus `TERM` and
  `JARVIS_BRIDGE_WORKSPACE` (so agent files resolve even when the shell runs in a project dir).

### Protocol

- **server → client:** raw text = PTY output; a JSON `{ type: "exit", code, signal }` on exit.
- **client → server:** a single-line JSON object starting with `{` is a control frame —
  `{ type: "resize", cols, rows }` (clamp cols 1–500, rows 1–200) or `{ type: "input", data }`; any
  other message is raw keystrokes to stdin. Binary frames are forwarded verbatim.

### Lifecycle & security

- Kill the PTY on socket `close`/`error`; close the socket (code 1000) on PTY exit.
- Gated by `JARVIS_BRIDGE_SHELL` (default on; set `false` to disable).
- **Security:** this endpoint is an **unsandboxed, unauthenticated host shell** — anyone who can reach
  the gateway port can run commands as the host user. Intended for **localhost-only** use. Document
  this loudly and let operators disable it.

### Drift note (2026-06-29)

The plan called for `node-pty@^1.0.0`, but v1.1.0's prebuilt `pty.node` is non-NAPI (compiled
against a specific Node-ABI) and fails with `posix_spawnp failed` on Node 25+ (current dev box
runs `node v25.6.1`). Drop-in replacement: **`@homebridge/node-pty-prebuilt-multiarch@^0.12`** — same
API, same `./typings/node-pty.d.ts`, but uses Node-API (`napi_get_version` / N-API V8 ABI) so it
works across Node versions including 25. Source code uses the homebridge fork's type module path
(`@homebridge/node-pty-prebuilt-multiarch`); the wrapper module shape (the `spawn` function and
`IPty` shape) is identical to `node-pty`.

## Slack helper — `src/slack/postMessage.ts` (optional)

A thin wrapper over the Slack Web API `chat.postMessage`.

```ts
async function slackPostMessage(
  botToken: string,
  args: { channel: string; text: string; thread_ts?: string }
): Promise<{ ok: true; channel: string; ts: string } | { ok: false; error: string; slack_error?: string }>;
```

POST JSON to `https://slack.com/api/chat.postMessage` with `Authorization: Bearer <botToken>`. Treat
`data.ok === false` (and missing `channel`/`ts`) as failure.

HTTP surface: `POST /slack/message` — `503` if no token configured, Zod-validate the body, map
upstream failure → `502`, success → `{ ok: true, channel, ts }`. Token comes from
`SLACK_BOT_TOKEN` (an `xoxb-...` bot token).

## Generic event hooks — analytics seam (optional, no-op by default)

A pluggable place to record UI/usage events. **There is no real analytics client** in this
re-implementation — implement the endpoints as no-ops, or wire your own sink behind them.

### Backend

- `GET /analytics/config` → `{ enabled: false, ... }` by default. The frontend reads this once on
  load; if `enabled` is false it never posts.
- `POST /analytics/track` → accept a single event or `{ events: [...] }`; validate with Zod (a
  `screen` event or a `ui`/`track`/`operational` action event); respond `204` immediately
  (fire-and-forget). With no sink, drop the events.

Suggested event envelope (validator-agnostic):

```ts
type EventEnvelope =
  | { type: "screen"; name: string; attributes?: Record<string, string | number | boolean | null> }
  | { type: "ui" | "track" | "operational"; source: string; actionSubject: string; action: string;
      actionSubjectId?: string; attributes?: Record<string, string | number | boolean | null> };
```

### Frontend — `public/js/analytics.js`

A fire-and-forget forwarder, safe to ship as a stub:

- On first use, do a one-time `GET /analytics/config`; buffer events fired before it resolves (cap the
  buffer, drop oldest).
- If `enabled`, `POST /analytics/track` (JSON, `keepalive`); if disabled, discard. Never block the
  app; swallow all errors.
- Carry a per-tab `sessionId` on every event; flush pending events via `navigator.sendBeacon` on
  `pagehide`/`beforeunload`.
- Expose `window.jarvisAnalytics.{ sendScreenEvent, sendUIEvent, sendTrackEvent, flush, isEnabled }`.
  The behavior modules call these; with the no-op config they do nothing.

> If you do not want any analytics seam at all, you can delete `analytics.js` and the two endpoints —
> nothing else depends on them functionally.
