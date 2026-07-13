# 2026-07-13 — ChatsDrawer sort + backend filter, auto-approve default

**Date:** 2026-07-13
**Session:** opencode big-pickle

## Summary

Two frontend UX improvements to ChatsDrawer and a config change for auto-approve.

### 1. Chats sorted by most recent first

`frontend/src/components/ChatsDrawer.tsx` — sessions in the Chats drawer are now sorted by `updatedAt` descending (newest first), with pinned sessions always at the top. Previously sessions appeared in whatever order the backend returned them (essentially random).

### 2. Backend filter dropdown in ChatsDrawer

`frontend/src/components/ChatsDrawer.tsx` — added a "Backend" filter dropdown next to the existing "Workspace" filter in the Chats drawer header. Only appears when 2+ backends have sessions. Filter persists to `localStorage` (`jarvis.lastChatsBackendFilter`).

Both workspace and backend filters are applied conjunctively (AND logic).

### 3. Auto-approve default set to true

Set `AGENT_AUTO_APPROVE=true` in `.env`. The env var seeds `session_metadata.json` on first startup; persisted value takes precedence after that.

## Files modified

- `.env` — `AGENT_AUTO_APPROVE=false` → `true`
- `frontend/src/components/ChatsDrawer.tsx` — sort by updatedAt desc, pinned first; backend filter state + dropdown + localStorage persistence
- `frontend/src/state/useChat.ts` — reverted (initial backend dropdown attempt was undone)
- `frontend/src/components/ChatPanel.tsx` — reverted (initial backend dropdown attempt was undone)

## Key decisions

- Backend filter is drawer-only (not in ChatPanel header) — matches the user's request for filtering the chat list, not selecting a backend for new chats.
- Sort order: pinned first, then by `updatedAt` descending. No `createdAt` field is available from the API.
- Backend dropdown only renders when `backends.length > 1` (hides when only one backend has sessions).

## Follow-up

- If the user wants a backend selector for _new chats_ (in the ChatPanel header), that's a separate feature — the infrastructure was prototyped and reverted.
