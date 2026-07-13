# Design: Open New Chat in a Specific Workspace

## Goal

Let the user start a new chat rooted at an arbitrary directory on disk, chosen
via a folder picker, instead of always defaulting to the gateway's configured
workspace.

## Context

- The backend already supports this at the protocol level: `GET /chat/init`
  accepts an optional `?cwd=` query param (`src/server.ts:61-73`), validates
  it's a directory, and routes to `backendPool.getOrCreate(cwd)`
  (`src/agent/backendPool.ts`), which spins up (or reuses) a per-cwd agent
  backend. This design adds a UI to invoke that existing capability — it does
  not change `/chat/init` itself.
- **Revision note:** an earlier version of this spec designed a custom
  server-side directory-browser endpoint + in-app modal, reasoning that a
  browser can't get a real filesystem path from a folder dialog. That's true
  for the browser tab itself, but it turned out irrelevant: `src/server.ts`
  already has a stub `POST /chat/pick-folder` (returns 501 unconditionally),
  and the archived API doc (`docs/archives/implementation/03-http-api.md:153-155`)
  describes its intended contract: a **native macOS folder dialog** — body
  `{ initialCwd? }` → `{ ok: true, cancelled, cwd }`, `501` off-macOS. The
  Node backend is a trusted local process on the user's own machine, so it
  can legitimately shell out to `osascript -e 'choose folder'` and get back a
  real absolute path. This is simpler than the browser-modal approach (no new
  directory-listing route, no `$HOME` sandboxing question, no breadcrumb UI)
  and matches pre-existing, documented intent. Confirmed with user: pivot to
  finishing `/chat/pick-folder` instead.
- The agent capability flag `customWorkingDirectory` (`src/agent/types.ts`)
  already exists and is `true` for the ACP backend, `false` for the stub
  backend, but isn't yet consumed by the frontend. This design gates the new
  UI on it, the same way the existing Fork button is gated on `canFork`.

## Architecture

### Backend: finish `POST /chat/pick-folder`

Replace the stub body in `src/server.ts:364-366`.

- Body: `{ initialCwd?: string }` (validated via a new Zod schema,
  `PickFolderBodySchema`).
- Platform guard: if `process.platform !== "darwin"`, respond `501
  { error: "folder picker not supported on this platform" }` — this is the
  existing stub behavior, preserved as a fallback for non-macOS.
- On macOS, invoke the native picker via an **injectable** function so tests
  never have to spawn a real GUI dialog:
  ```ts
  export type PickFolderFn = (
    initialCwd?: string,
  ) => Promise<{ cancelled: boolean; cwd: string | null }>;
  ```
  `CreateServerOptions` gains an optional `pickFolder?: PickFolderFn`,
  defaulting to the real `osascript`-backed implementation. Tests inject a
  fake.
- Real implementation (`src/pickFolder.ts`, new file):
  - Builds an AppleScript string: `choose folder with prompt "Select a
    workspace folder"`, plus ``default location (POSIX file "<escaped
    initialCwd>")`` appended when `initialCwd` is provided **and**
    `fs.stat(initialCwd)` confirms it's an existing directory (silently
    ignored otherwise — same "forgiving fallback" spirit as the rest of this
    feature).
  - `initialCwd` is escaped for embedding in the AppleScript string literal
    (backslashes and double quotes escaped) before being spliced in — this is
    AppleScript-string escaping, not shell escaping. The whole script is
    always a single fixed argv element passed to `execFile("osascript", ["-e",
    script])` (never `exec`/`shell: true`), so there is no shell-injection
    vector; the escaping only prevents a malicious `initialCwd` from breaking
    out of the AppleScript string literal.
  - Wraps the whole thing in `POSIX path of (...)` so `osascript` prints an
    absolute path.
  - Success: `execFile` resolves, `stdout.trim()` is the path → `{ cancelled:
    false, cwd: path }`.
  - User clicks Cancel in the dialog: AppleScript exits with "User canceled"
    (error -128); caught and mapped to `{ cancelled: true, cwd: null }`.
  - Any other failure: rethrown, caught by the route handler and turned into
    a 500 with the error message.
- Route response shape: `{ ok: true, cancelled: boolean, cwd: string | null }`
  on success paths; `501`/`500` error bodies otherwise. Matches the archived
  doc's documented contract.

### Frontend

No new modal component. The button directly drives the request/response
cycle:

- `ChatPanel` (`frontend/src/components/ChatPanel.tsx`): new button
  `+ New in...` next to the existing `+ New`, always rendered,
  `disabled={!ctx.state.capabilities?.customWorkingDirectory || chat.busy ||
  pickingFolder}` (new local `pickingFolder` state for the in-flight request)
  — matches the existing Fork/Steer/AA buttons' visible-but-disabled pattern.
- On click: `POST /chat/pick-folder` with `{ initialCwd: <last-used path from
  localStorage, if any> }`. This call blocks until the user picks or cancels
  in the native dialog — no client-side timeout, since there's no
  server-side request timeout configured either (confirmed: none in
  `src/server.ts`/`src/index.ts`).
  - `res.ok === false` or `data.ok !== true` (covers the 501/500 cases): toast
    an error (`"Folder picker unavailable"` or the server's error message),
    button re-enabled.
  - `data.cancelled === true`: no-op, button re-enabled, no toast (user just
    changed their mind).
  - `data.cwd` present: call `chat.startNewChatInWorkspace(data.cwd)`
    (new `useChat` method, twin of `startNewChat`, calls `ctx.init(null,
    cwd)`), then persist `data.cwd` to `localStorage["jarvis.lastWorkspace"]`
    (matches the existing `jarvis.quickPhrases` naming convention in
    `SettingsPanel.tsx`), then set the chat title to the folder's basename
    (`cwd.split("/").filter(Boolean).pop()`).

## Data flow

1. User clicks "+ New in..." → button disables, `POST /chat/pick-folder`
   fires with `initialCwd` from `localStorage` if present.
2. Native Finder "choose folder" dialog opens (macOS only), pre-navigated to
   `initialCwd` when given and valid.
3. User picks a folder → route resolves `{ ok: true, cancelled: false, cwd:
   "<abs path>" }`. User clicks Cancel → `{ ok: true, cancelled: true, cwd:
   null }`.
4. On a real pick: `chat.startNewChatInWorkspace(cwd)` → `GET
   /chat/init?cwd=<cwd>` (existing, unmodified endpoint) → new session
   rooted there, transcript resets, title set from the folder's basename;
   `cwd` saved to `localStorage`.
5. On cancel or error: button re-enables, no session change.

## Error handling summary

| Failure | Behavior |
|---|---|
| Non-macOS platform | 501, toast "Folder picker unavailable", button re-enabled |
| User clicks Cancel in the dialog | No-op, no toast, button re-enabled |
| `osascript` fails for another reason | 500 with message, toast shows it, button re-enabled |
| `/chat/init?cwd=` not a directory | Existing 400 behavior, unchanged — surfaced as a toast same as other init failures (very unlikely here since the path just came from a live native dialog, but the existing check stays as-is) |

## Testing plan

- Backend (`node:test`, extend `src/server.test.ts` following the existing
  `withServer` helper pattern): inject a fake `pickFolder` via
  `CreateServerOptions.pickFolder` —
  - successful pick returns `{ ok: true, cancelled: false, cwd }` from the
    route;
  - cancelled pick returns `{ ok: true, cancelled: true, cwd: null }`;
  - a rejected `pickFolder` promise surfaces as a 500;
  - platform guard: temporarily stub `process.platform` (or inject the
    platform check itself as a seam) to confirm 501 off-macOS regardless of
    the injected `pickFolder`.
  - `src/pickFolder.test.ts` (new, only runs meaningfully on macOS): a
    thin unit test around the AppleScript-string-building/escaping logic
    (given a path with a `"` and a `\`, assert the built script string
    escapes both) — does not actually invoke `osascript`.
- Frontend (Vitest): `ChatPanel.test.tsx` — clicking "+ New in..." when
  `customWorkingDirectory` capability is absent is a no-op (button
  disabled); `useChat.test.tsx` — new case for `startNewChatInWorkspace`
  asserting it calls `/chat/init` with the right `cwd` query param and
  resets transcript/title.

## Out of scope

- No change to `/chat/init`'s own validation or trust boundary — it already
  accepts any directory path today (pre-existing behavior via manual
  `?cwd=` URL construction); this design only adds a discoverable UI for
  producing that value via a native dialog.
- No cross-platform (Windows/Linux) native picker implementation — matches
  the pre-existing stub's macOS-only scope; other platforms keep getting the
  501.
- No favorites/pinned workspaces list beyond the single last-used path (used
  only to pre-seed `initialCwd`).
