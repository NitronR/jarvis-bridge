# Top Bar Redesign

## Goal

Move session-specific controls (Title, Group, Pin) from the InfoPanel into the ChatPanel header bar, removing the now-empty "Current chat" section and reordering the remaining InfoPanel sections.

## Current State

**ChatPanel header** (left → right):
`[Dot] Title (h1, static)` → `+ New` → `↓ Follow` → `☰ Chats` → `│` → `Info` → `+ New in...` → `Fork` → `⚙ Settings`

**InfoPanel** (top → bottom):
1. "Current chat" — Title (click-to-edit), Group (native `<select>`), Pinned (Button)
2. "Usage" — rate limits, meters, cost
3. "Session & workspace" — Workspace, ID, Slash cmds

## Proposed State

**ChatPanel header** (left → right):
`[Dot] Title (click-to-edit)` → `Group (Select)` → `+ New` → `↓ Follow` → `☰ Chats` → `│` → `Info` → `+ New in...` → `Fork` → `📌 Pin` → `⚙ Settings`

**InfoPanel** (top → bottom):
1. "Session & workspace" — Workspace, ID
2. "Usage" — rate limits, meters, cost (unchanged)

## Changes

### 1. Title — click-to-edit in header

Replace the static `<h1>` title with a click-to-edit control:

- **Default state:** subtle underline always visible (dotted or solid thin, `--color-text-muted`)
- **Hover state:** underline becomes stronger/bolder, thin border appears around the title area, cursor changes to text cursor
- **Edit state:** `<input>` replaces the title text, pre-filled with current title
- **Save:** Enter key or blur commits the change
- **Cancel:** Escape reverts to original title
- **Placeholder:** "New chat" (italic, muted) when no title set — same as current

The pencil icon from the current InfoPanel title is **not** used. The underline + border on hover is the affordance.

### 2. Group — Select in header

Move the Group field from InfoPanel to the header, immediately right of the title with a small gap (`var(--space-4)` or `4px`).

- Use the `Select` primitive (`frontend/src/components/ui/Select.tsx`) — same component used for model selection in Composer
- Options: "None" (value `""`) + each group name + "+ Add Group…" (value `__add_group__`)
- "+ Add Group…" triggers the existing `addGroupOpen` dialog (moved from InfoPanel to ChatPanel)
- `aria-label="Group"`

### 3. Pin — icon button in header

Add a Pin toggle button to the header, left of the Settings gear icon.

- Same pin icon SVG currently in InfoPanel
- Toggle behavior: click toggles pinned state
- Visual: filled when pinned, outline when unpinned (or use the existing `pinButton`/`pinButtonActive` CSS classes moved to ChatPanel)
- `aria-label="Pin session"` / `"Unpin session"`

### 4. Remove "Current chat" section from InfoPanel

Delete the entire first `<div className={styles.section}>` block (Title, Group, Pin) from InfoPanel. Also delete:
- `titleDraft` / `editingTitle` state and related handlers (`openTitleEdit`, `commitTitle`, `revertTitle`)
- `addGroupOpen` / `newGroupName` state and `handleGroupChange` / `handleCreateGroup` handlers
- The add-group dialog JSX

These are moved to ChatPanel (Title editing logic) or stay in InfoPanel as props (Group dialog logic moves to ChatPanel).

### 5. Remove "Slash cmds" from InfoPanel

Delete the "Slash cmds" row from the "Session & workspace" section:
```tsx
<div className={styles.row}>
  <span className={styles.key}>Slash cmds</span>
  <span className={styles.val}>{state.slashCommands.length}</span>
</div>
```

### 6. Reorder InfoPanel sections

Move "Session & workspace" above "Usage":
1. Session & workspace (Workspace, ID)
2. Usage (rate limits, meters, cost)

### 7. Update InfoPanel props

Remove props that are no longer used by InfoPanel:
- `title`, `group`, `groups`, `pinned`, `onRename`, `onGroup`, `onAddGroup`, `onPinned`

These are now consumed by ChatPanel directly (Title edit, Group Select, Pin button).

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/ChatPanel.tsx` | Add click-to-edit title, Group Select, Pin button to header; move group dialog state here |
| `frontend/src/components/ChatPanel.module.css` | Add title edit styles (underline, hover border), group select spacing, pin button styles |
| `frontend/src/components/InfoPanel.tsx` | Remove "Current chat" section, remove Slash cmds row, reorder sections, trim props |
| `frontend/src/components/InfoPanel.module.css` | Remove unused title/pin styles |
| `frontend/src/components/InfoPanel.test.tsx` | Update tests: remove title/group/pin tests, add session-workspace-first ordering test |

## Out of Scope

- No new CSS tokens
- No changes to the `Select` component itself
- No changes to the Usage section
- No changes to the "Add Group" dialog UI (just its location)
