# ACP tool rendering improvements

**Date**: 2026-07-22

## Summary

Implemented syntax-highlighted JSON rendering for ACP tool calls, fixed empty `{}` input
display, and threaded backend-specific extensibility through the component tree.

## Work done

### 1. Fixed `{}` empty input display

ACP backends (opencode, Claude) send `rawInput: {}` on the initial `tool_call`
notification; real args arrive on a subsequent `tool_call_update`. Previously,
`extractToolInput()` in `mapping.ts` treated `{}` as valid, causing premature
finalization and `{}` rendering in the UI.

Added `isEmptyRawInput()` helper and updated `extractToolInput()` to treat `{}` as
empty (return `undefined`), deferring finalization until real args arrive. Added a
test case in `mapping.test.ts`.

### 2. Created `JsonView` component

New zero-dependency component at `frontend/src/components/ui/JsonView.tsx` with
`JsonView.module.css`. Recursive `JsonNode` component renders JSON with syntax
coloring (keys, strings, numbers, booleans, null) using design-system CSS tokens.
Depth limit of 3 — objects/arrays beyond that collapse to `…N keys` / `…N items`.
Optional `copyButton` prop for tool output. `maxHeight` prop for scrollable overflow.

### 3. Integrated JsonView into Timeline

Replaced raw `<pre>` (tool args) and bare text (tool result) in `Timeline.tsx` with
`<JsonView>`. Added `argsRaw` and `result.raw` fields to `Bubble` type for direct
pass-through to JsonView (avoiding double-stringify). Removed `.toolArgs` CSS class.

### 4. Threaded `backendKind` for future extensibility

Added `backendKind: string | null` to `ChatState` in `ChatContext.tsx`, initialized
from `ChatInitResponse.backend.kind`. Threaded through `ChatPanel` → `Transcript` →
`Message` → `Timeline` → `renderBubble` (as `_backendKind`, currently unused).

### 5. Threaded `_meta` through `ChatPatch`

Added `meta?: Record<string, unknown>` to `tool-call-start` and `tool-call-finalized`
in both backend (`src/agent/types.ts`) and frontend (`frontend/src/api/types.ts`)
`ChatPatch` types. `_meta` from ACP `session/update` notifications is copied into
patches by `acpUpdateToPatches()` and carried through `Bubble.meta` in Timeline.

## Key decisions

- **Zero dependencies for JsonView**: Project has no syntax highlighting library.
  Custom recursive renderer chosen over prism/highlight.js/collapsible-tree to keep
  the bundle small and avoid adding a dependency for a single use case.
- **Depth limit of 3**: Balances readability with safety against deeply nested agent
  output. Collapse behavior (`…N keys`) preserves count information.
- **`meta` as optional on ChatPatch**: Backends that don't populate `_meta` don't need
  to carry the field; consumers check for presence before use.
- **`_backendKind` unused for now**: The prop is threaded and available, but no
  backend-specific rendering was added in this session — the plumbing is the
  prerequisite, the rendering is a follow-up.

## Files modified

| File | Change |
|---|---|
| `src/agent/acp/mapping.ts` | `isEmptyRawInput()`, pass `_meta` to tool patches |
| `src/agent/acp/mapping.test.ts` | Added deferred-finalization test |
| `src/agent/types.ts` | Added `meta` to `tool-call-start`/`tool-call-finalized` |
| `frontend/src/api/types.ts` | Added `meta` to `tool-call-start`/`tool-call-finalized` |
| `frontend/src/components/ui/JsonView.tsx` | **New** — syntax-colored JSON renderer |
| `frontend/src/components/ui/JsonView.module.css` | **New** — JsonView styles |
| `frontend/src/components/Timeline.tsx` | Use JsonView, store raw content, accept `backendKind`, thread `meta` |
| `frontend/src/components/Timeline.module.css` | Removed `.toolArgs` |
| `frontend/src/state/ChatContext.tsx` | Added `backendKind` to `ChatState` |
| `frontend/src/components/ChatPanel.tsx` | Pass `backendKind` to Transcript |
| `frontend/src/components/Transcript.tsx` | Accept + pass `backendKind` |
| `frontend/src/components/Message.tsx` | Accept + pass `backendKind` |
| `frontend/src/components/InfoPanel.test.tsx` | Add `backendKind` to test fixture |
| `docs/frontend-components.md` | Documented JsonView, backendKind threading |
| `docs/acp-notes.md` | Documented `_meta` tool-patch flow |

## Follow-up tasks

1. Add backend-specific rendering in `renderBubble` using `_backendKind` + `meta`
   (e.g. Claude tool name vs opencode `locations[]`).
2. Write `JsonView.test.tsx`.
3. Consider adding `meta` to `tool-return`/`tool-error` patches if backend-specific
   result rendering is needed.

## Verification

- Backend typecheck: pass
- Frontend typecheck: pass
- Backend tests: 206/206 pass
- Frontend Timeline tests: 9/9 pass
