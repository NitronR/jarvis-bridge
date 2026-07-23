# Open-Source Chat Composer Research

Research into four open-source projects' chat input composer implementations to inform our own redesign.

**Date:** 2026-07-20  
**Projects:** Happy, Codeg, AgentRQ, ACP-UI

---

## Happy

**Tech Stack:** React Native (Expo), TypeScript  
**Location:** `~/Desktop/opensource/happy/packages/happy-app/sources/`

### Composer Architecture

The main composer is `AgentInput.tsx` (~1000 lines) — a complex component handling multiple concerns:

- **Attachment Strip** (`AgentInputAttachmentStrip.tsx`): Horizontal scrollable row of image thumbnails with thumbhash placeholders, remove buttons, and count badge. Images are base64-encoded and attached to the message payload.
- **Rich Text Input** (`MultiTextInput.tsx`): Core text input with auto-resize, Enter-to-send (Shift+Enter for newline), height animation, and keyboard shortcut handling.
- **Model/Permission/Effort Selectors**: Horizontal option pills at the bottom; tap to cycle through modes (e.g., permission modes: `default`, `bypassPermissions`, `plan`). Model options are defined in `modelModeOptions.ts` with provider-specific icons (Anthropic, Google, OpenAI, etc.).
- **Slash Commands & File Mentions** (`AgentInputAutocomplete.tsx`): Dropdown appears on `/` or `@` with arrow-key navigation; shows command suggestions (`/clear`, `/compact`) or file mention results.
- **Send Button**: Disabled until message has content or attachments; shows loading spinner during generation.

### Key Design Decisions
- **Mobile-first**: Full composer visible at all times, no keyboard dismissal needed.
- **Attachment-first**: Image paste/drag is prominent; thumbs are pre-generated for fast rendering.
- **Permission modes**: Cycled by tapping a single pill rather than a separate modal.
- **No fork/steer**: Focuses on single-session input; no queue or multi-turn steering.

---

## Codeg

**Tech Stack:** Next.js 14, React 18, Tiptap (rich text), Zustand, shadcn/ui  
**Location:** `~/Desktop/opensource/codeg/src/components/chat/`

### Composer Architecture

Top-level orchestrator: `chat-input.tsx` → composes `MessageInput`, `QueueDisplay`, `ConfigSelectors`, and `ExpertSelector`.

**`message-input.tsx`** (~3100 lines) — the main composer:
- **Rich Text Editor** (`rich-composer.tsx`): Tiptap-based with mention/reference support, slash commands, file references. Supports bold, italic, code blocks inline.
- **Action Bar**: Horizontal row with:
  - **Paperclip button**: Opens file picker for image uploads (stored as `ImageAttachment[]` with base64 data).
  - **Plus button**: Opens a menu for additional options (e.g., add context).
  - **Send + Fork Split Button**: Single button with two actions:
    - **Send**: Submit message to current session.
    - **Fork**: Submit message as a new branch (fork from current turn).
  - **Stop button**: Appears during generation; cancels the stream.
- **Queue System**: Messages can be queued and sent sequentially; queue is displayed below the input.
- **Image Paste**: Handles clipboard paste of images directly into the composer.
- **Attachment UI**: Shows uploaded images as removable thumbnails above the input area.

**`model-option-picker.tsx`**: Wide-form popover model selector with:
- Search/filter input at top.
- Virtualized list for long model lists (important for providers with many models).
- Model icons and provider labels.

**`agent-selector.tsx`**: Agent type selector (e.g., "code", "plan") with fallback logic — if the selected agent isn't available for the model, it falls back to the default.

**`mode-selector.tsx`**: Session mode dropdown (radio items for different modes like "code", "plan").

**`quick-actions.tsx`**: Quick action cards/chips for common tasks (research, office tasks) and expert selection tabs.

### Key Design Decisions
- **Split send/fork button**: Explicit control over branching — users choose between continuing or forking.
- **Queue system**: Allows batching multiple messages before sending.
- **Virtualized model picker**: Handles large model lists efficiently.
- **Quick actions**: Pre-built task templates for common workflows.
- **Rich text**: Full Tiptap editor for formatted input.

---

## ACP-UI

**Tech Stack:** Vue.js 3, TypeScript, Tailwind CSS  
**Location:** `~/Desktop/opensource/acp-ui/src/components/`

### Composer Architecture

**`ChatView.vue`**: Main chat view containing the composer:
- **Textarea**: Simple `<textarea>` element with auto-resize.
- **Model Picker** (`ModelPicker.vue`): Dropdown selector with emoji icons per provider (e.g., 🔵 for Anthropic, 🟢 for Google). Click-outside close behavior.
- **Mode Picker** (`ModePicker.vue`): Dropdown mode selector with emoji icons per mode type (e.g., "Code", "Plan").
- **Slash Commands**: Supports slash commands (e.g., `/clear`) with a simple dropdown.
- **Send/Stop Button**: Toggle between send (arrow icon) and stop (square icon) based on generation state.
- **Message Display**: Renders assistant messages with markdown (via a markdown renderer component).

### Key Design Decisions
- **Simplicity**: Minimalist design — just textarea + two dropdowns + send button.
- **No attachments**: Text-only input; no image/file upload support.
- **No queue/steer**: Single message input, no batching or branching.
- **Markdown rendering**: Assistant responses rendered as formatted markdown.
- **Click-outside dismiss**: Dropdowns close when clicking outside.

---

## AgentRQ

**Tech Stack:** Vue.js 3, TypeScript, Pinia, Tailwind CSS  
**Location:** `~/Desktop/opensource/agentrq/frontend/src/`

### Architecture

**Not a chat app.** AgentRQ is a task management / Kanban system with:
- **Task queues** (scheduled and ad-hoc)
- **Workspace boards** (Kanban-style)
- **Task detail views** (`TaskDetailView.vue`): Task input fields for editing task properties, not a chat composer.

No chat input, message composer, or conversation UI exists in this project. It's a task orchestration frontend.

---

## Comparison Matrix

| Feature | Happy | Codeg | ACP-UI | AgentRQ |
|---------|-------|-------|--------|---------|
| **Text Input** | Auto-resize textarea | Tiptap rich editor | Simple textarea | N/A |
| **Image Attachments** | Yes (paste, drag) | Yes (paste, file picker) | No | No |
| **File Attachments** | Yes (via mentions) | Yes (paperclip) | No | No |
| **Model Selector** | Horizontal pills | Virtualized popover | Dropdown | N/A |
| **Permission/Mode** | Tap-to-cycle pill | Dropdown selector | Dropdown | N/A |
| **Slash Commands** | Yes (`/clear`, etc.) | Yes | Yes | No |
| **Fork/Branch** | No | Yes (split button) | No | No |
| **Queue** | No | Yes | No | Yes (tasks) |
| **Send Button** | Single | Split (send/fork) | Toggle (send/stop) | N/A |
| **Quick Actions** | No | Yes (chips/cards) | No | No |
| **Auto-resize** | Yes | Yes | Yes | N/A |

---

## Key Takeaways for Our Composer

1. **Rich text is a nice-to-have** — Happy and ACP-UI use plain textarea; only Codeg uses Tiptap. Start simple.
2. **Attachments matter** — Happy and Codeg both support image paste/upload. Consider supporting at least image paste.
3. **Model selection UI varies widely** — Horizontal pills (Happy), virtualized popover (Codeg), or dropdown (ACP-UI). Dropdown is simplest.
4. **Fork/branch control** — Only Codeg offers explicit fork via a split send button. Worth considering for multi-turn steering.
5. **Queue system** — Codeg queues messages; Happy and ACP-UI don't. Depends on use case.
6. **Permission modes** — Happy cycles via pill tap; Codeg uses a dropdown. Simple toggle or cycle is best.
7. **Quick actions** — Codeg's preset task templates could reduce friction for common workflows.
