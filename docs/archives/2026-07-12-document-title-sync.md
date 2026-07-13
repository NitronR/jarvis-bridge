# 2026-07-12: Sync browser tab title with session title

## Summary

Added `document.title` syncing to the chat UI: the browser tab now shows the
current session's title (e.g. "My renamed session — Jarvis Bridge") instead
of the static "Jarvis Bridge" from `frontend/index.html`. The title updates
live when the session is renamed and resets to the default when navigating
away from the chat route.

## Implementation

Two `useEffect`s added in `ChatPanelInner` (`frontend/src/components/ChatPanel.tsx`),
right after the existing `jarvis:cwd-changed` effect:

- One effect, keyed on `ctx.state.title`, sets
  `` document.title = `${ctx.state.title || "New chat"} — Jarvis Bridge` ``.
  Since `InfoPanel`'s rename input already calls `ctx.setTitle(...)`
  synchronously on every keystroke (`onRename` in `ChatPanel.tsx`), this
  effect fires automatically on rename with no new event plumbing needed.
- A second effect with an empty dependency array whose cleanup resets
  `document.title = "Jarvis Bridge"` on unmount, so switching to
  Settings/Skills/Status routes doesn't leave a stale session title in the
  tab.

No changes were needed in `ChatContext.tsx` or `useChat.ts` — the existing
`title` state and `setTitle` setter were sufficient.

## Key decision

`ChatProvider` (and thus `ctx.state.title`) is scoped inside `ChatPanel`,
not wrapped around `App` — so the effect had to live in `ChatPanelInner`
rather than `App.tsx`. Lifting `ChatProvider` up was considered and rejected
as unnecessary scope creep for this task.

## Verification

- `tsc --noEmit`: no new errors (pre-existing CSS-module/test-mock errors
  confirmed identical on `main` via `git stash` before/after comparison).
- Wrote a throwaway Vitest + Testing Library test mounting `<ChatPanel />`
  with mocked `fetchJSON`, asserting: title set on load
  (`New chat — Jarvis Bridge`), title updates on simulated rename via the
  `InfoPanel` title input, title resets to `Jarvis Bridge` on unmount.
  Test passed, then was deleted (not part of the permanent suite — full
  intent was throwaway verification, not new coverage).
- Full frontend suite (`npx vitest run`): 18 files / 64 tests pass,
  unchanged from `main`.
- No live browser check was possible mid-session because no backend/ACP
  agent was running yet. Backend was later confirmed already running on
  `:3001` (existing process, `AGENT_CMD=opencode`, `AGENT_ARGS=acp` from
  `.env`) and frontend dev server started on `:5173` for the user to test
  manually. User confirmed "working" after manual testing.

## Files modified

- `frontend/src/components/ChatPanel.tsx` — added the two `useEffect`s.

## Follow-ups (not yet done)

- Decide whether `SettingsPanel`/`SkillsManagePanel`/`SkillPanel` routes
  should set their own route-specific `document.title` for consistency
  (currently only the chat route touches `document.title`).
- No commit has been made yet — pending explicit user go-ahead.
