# Terminal drawer stuck at "connecting" — root cause + fix

- **Date:** 2026-07-18
- **Session ID:** cc139f33-20c8-4ad7-849d-c7e4be1991cf

## Summary

User reported the terminal drawer was permanently stuck showing "connecting…" and
never attaching to a shell. Debugged with `superpowers:systematic-debugging`.

## Investigation

- Confirmed `JARVIS_BRIDGE_SHELL=true` in `.env`, so `attachTerminalServer` was enabled
  server-side and `src/terminal.ts` itself was never suspect.
- Found both dev processes running: backend (`ts-node src/index.ts`, port 3001) and
  frontend Vite dev server (port 5173).
- `TerminalDrawer.tsx` opens its WebSocket against `window.location.host`, which in
  dev mode is the Vite server (`:5173`), not the backend (`:3001`).
- `frontend/vite.config.ts`'s dev `proxy` block had entries for every backend HTTP
  route (`/chat`, `/health`, `/status`, `/workspace`, `/skills`, `/slack`,
  `/analytics`, `/tools`, `/settings`) but **no `/terminal` entry**.
- Reproduced directly: a raw `ws://localhost:5173/terminal` handshake never opened,
  errored, or closed — it just hung indefinitely, matching the reported symptom
  exactly. The same handshake against `ws://localhost:3001/terminal` opened in ~12ms.
- Root cause: Vite's dev server has no route/proxy target for `/terminal`, so the
  upgrade request is left unhandled rather than rejected — it just hangs forever
  instead of failing fast.

## Fix

Added a `/terminal` proxy entry to `frontend/vite.config.ts`, using the object form
with `ws: true` (WebSocket proxying is **not** automatic for the string-shorthand
proxy target form used by the other routes — it requires the explicit `ws: true`
flag):

```ts
"/terminal": { target: "ws://localhost:3001", ws: true },
```

Restarted the Vite dev server (`vite.config.ts` changes aren't hot-reloaded) and
verified the WS handshake now completes in ~8ms through the proxy.

## Scope / non-impact

This bug only affects `npm run dev:web` (Vite dev server on 5173). Production /
built usage — serving `public/` directly from the backend on port 3001 — was never
affected, since in that mode there's only one HTTP server and no proxy hop.

## Files modified

- `frontend/vite.config.ts` — added `/terminal` WS proxy entry.

## Follow-up / next steps

- Reload the frontend tab and confirm the terminal drawer connects to a live shell.
- Consider adding a short note to AGENTS.md (Backend configuration section) that any
  new backend HTTP/WS route needs a matching entry in `frontend/vite.config.ts`'s dev
  proxy — this is an easy gotcha to hit again when adding new WS-based features.
- The unrelated uncommitted changes already in the working tree (`App.tsx`,
  `ChatPanel.tsx`/`.module.css`, `Sidenav.tsx`/`.module.css`/`.test.tsx`) were not
  touched by this session and are still pending review/commit.
