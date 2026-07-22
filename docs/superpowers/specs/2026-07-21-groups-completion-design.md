# Groups Completion Design

## Current State

The group feature is **backend-complete** but **frontend-incomplete**:

- **Backend (done)**: `group?: string` on `SessionMetadata`, persisted in `session_metadata.json`, CRUD via `PATCH /chat/sessions/:id`, returned by `GET /chat/init` and `GET /chat/sessions`. Tests pass.
- **Frontend (partial)**: State in `ChatContext`, group pill rendered in `ChatsDrawer`, plain text input in `InfoPanel` that fires a PATCH on every keystroke. No filtering by group. No concept of registered groups.

## Goal

Complete the group feature with:

1. **Backend endpoints** for registering and listing groups as first-class entities
2. **InfoPanel dropdown** replacing the free-text input, with "Add Group" dialog
3. **ChatsDrawer Groups tab** showing a collapsible accordion of groups and their sessions

---

## 1. Backend — Groups Storage & Endpoints

### Storage

Groups are persisted as a `string[]` in the existing `session_metadata.json`:

```json
{
  "groups": ["bugfix", "feature", "research"],
  "metadata": { ... },
  "autoApprove": { ... }
}
```

No new file. Groups sit alongside the existing top-level keys in `PersistedFileShape`.

### `sessionConfigStore.ts` Changes

- Add `groups?: unknown` to `PersistedFileShape`
- On load, sanitize: accept only `string[]`, filter out non-string entries
- New interface methods:
  - `getGroups(): string[]`
  - `addGroup(name: string): Promise<string[]>` — deduplicates (case-insensitive), persists, returns updated list

### `server.ts` New Routes

| Route | Method | Body | Response |
|-------|--------|------|----------|
| `/chat/groups` | GET | — | `{ groups: string[] }` |
| `/chat/groups` | POST | `{ name: string }` | `{ ok: true, groups: string[] }` |

- POST validates `name` is a non-empty string via Zod (`z.string().min(1).max(100)`)
- POST deduplicates (case-insensitive match against existing groups)
- POST returns the full updated list so the frontend can refresh without an extra GET

### Tests

- `addGroup` adds a new group, persists across reload
- `addGroup` deduplicates (case-insensitive)
- `addGroup` rejects empty/whitespace-only names
- Malformed `groups` in persisted JSON (non-array, non-string entries) is sanitized on load
- Route tests: GET returns list, POST creates and returns updated list, POST rejects duplicate

---

## 2. Frontend — InfoPanel Group Dropdown

### Changes to `InfoPanel.tsx`

Replace the free-text `<input>` (line 111) with:

1. A `<select>` dropdown populated from the groups list in context
2. A blank/placeholder option (`"— None —"`) when no group is assigned
3. The last `<option>` is `"+ Add Group…"`
4. Selecting `"+ Add Group…"` opens a modal dialog with:
   - Text input for the new group name
   - Create / Cancel buttons
   - On Create: `POST /chat/groups`, refreshes groups list, assigns the new group to the current session via the existing `onGroup` callback

### Props Change

`InfoPanelProps` adds:
- `groups: string[]` — the list of known groups
- `onAddGroup: (name: string) => Promise<void>` — callback to register a new group

### State in `ChatContext`

- `groups: string[]` added to `ChatState` (default `[]`)
- `setGroups(groups: string[])` action added to `ChatContextApi`
- Groups fetched from `GET /chat/groups` during `init()` and stored in state

### `ChatPanel.tsx` Changes

- On init, fetch groups and store in context
- Pass `groups` and `onAddGroup` to `<InfoPanel>`
- `onAddGroup` calls `POST /chat/groups`, then refreshes the groups list in context

### Debouncing Fix

The existing `onGroup` callback fires a PATCH on every keystroke. With the dropdown, this is no longer an issue — the callback fires once on selection change. The `"+ Add Group…"` dialog also fires once on "Create".

---

## 3. Frontend — ChatsDrawer Groups Tab

### Tab Bar

Add a tab bar below the drawer header (above the search bar):

```
[ Chats ] [ Groups ]
```

- Two tabs: "Chats" (current flat list) and "Groups" (new accordion view)
- Tab selection persisted in `localStorage` under key `jarvis.lastChatsTab` (default `"chats"`)
- Tab styling: simple underline/pill indicator, consistent with existing filter select styling

### Groups Tab Content

When the "Groups" tab is active, the drawer shows a collapsible accordion:

- Each registered group is a **collapsible section**:
  - Header row: group name (bold) + session count badge + chevron icon
  - Clicking the header toggles expansion
  - Expanded: shows sessions assigned to that group as cards (same card component/style as the current flat list)
- An **"Ungrouped"** section at the bottom holds sessions with no `group` set
- Empty groups (registered but no sessions assigned) still appear in the list with "0 sessions"
- Sessions within each group are sorted by `updatedAt` descending (most recent first)

### Props Change

`ChatsDrawerProps` adds:
- `groups?: string[]` — the list of known groups (from context)

The existing `sessions` prop already contains `group` on each `SessionSummary`.

### Filtering Interaction

The Groups tab is independent of the workspace/backend/search filters — those filters apply to the "Chats" tab. The Groups tab always shows all groups and all sessions grouped accordingly.

### New CSS Classes (in `ChatsDrawer.module.css`)

- `.tabBar` — flex container for tab buttons
- `.tab` / `.tabActive` — individual tab button styles
- `.groupSection` — collapsible group wrapper
- `.groupHeader` — clickable header row with group name + count + chevron
- `.groupHeaderExpanded` — expanded state variant
- `.groupSessions` — session list within an expanded group
- `.chevron` — rotation animation for expand/collapse

---

## File Change Summary

| File | Change |
|------|--------|
| `src/agent/sessionConfigStore.ts` | Add `groups` to `PersistedFileShape`, sanitize on load, add `getGroups`/`addGroup` methods |
| `src/server.ts` | Add `GET /chat/groups` and `POST /chat/groups` routes with Zod validation |
| `src/agent/sessionConfigStore.test.ts` | Add tests for group CRUD, dedup, sanitization |
| `frontend/src/api/types.ts` | (no change needed — groups is a plain `string[]`) |
| `frontend/src/state/ChatContext.tsx` | Add `groups` to state, `setGroups` action, fetch in `init()` |
| `frontend/src/components/InfoPanel.tsx` | Replace text input with dropdown + add-group dialog |
| `frontend/src/components/ChatPanel.tsx` | Fetch groups, pass to InfoPanel, handle addGroup |
| `frontend/src/components/ChatsDrawer.tsx` | Add tab bar, Groups tab with collapsible accordion |
| `frontend/src/components/ChatsDrawer.module.css` | Add tab, group section, chevron styles |
| `frontend/src/components/InfoPanel.test.tsx` | Add tests for dropdown + dialog |
| `frontend/src/components/ChatsDrawer.test.tsx` | Add tests for Groups tab |

---

## Out of Scope

- Group deletion (no endpoint or UI for removing a registered group)
- Group renaming
- Drag-and-drop session assignment to groups
- Group-based filtering in the Chats tab ( Groups tab handles this)
- Color/icon customization per group
