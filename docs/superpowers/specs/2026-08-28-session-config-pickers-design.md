# Session config pickers (Mode / Effort / Agent)

**Date:** 2026-08-28
**Status:** design, not yet implemented

## Goal

Add dropdowns to the Composer for the session config options the connected backend
reports — for Claude that's **Mode**, **Effort**, and **Agent** — sitting next to the
existing Model picker. Backends that report nothing extra (opencode) render nothing
extra.

This is Phase 2 of the picker work deferred in `docs/claude-acp-future-phases.md`
("`session/set_mode` + `session/set_config_option` pickers").

## What already exists

Claude's adapter returns `configOptions[]` on `session/new` and `session/load`
(`docs/agent-claude-code.md:158-164`):

| id | category | type | values |
|---|---|---|---|
| `mode` | `mode` | select | auto, default, acceptEdits, plan, dontAsk, bypassPermissions |
| `model` | `model` | select | default, sonnet, opus, haiku, fable |
| `effort` | `thought_level` | select | default, low, medium, high, xhigh, max |
| `agent` | — | select | default + locally registered subagents |

`parseSessionConfig` (`src/agent/acp/index.ts:777`) already captures these into
`SessionContext.rawConfigOptions`, and `getSessionRawConfig` (`index.ts:688`) reads them
back. Nothing exposes them over HTTP — `rawConfigOptions` is currently touched only by
tests. So the data is already there; this design is transport + UI.

## Non-goals

- **Live sync of agent-initiated changes.** `current_mode_update` and
  `config_option_update` notifications are ignored today
  (`src/agent/acp/mapping.ts:241`). If the agent changes its own mode (e.g. leaving plan
  mode), the picker goes stale until reload. User-initiated changes stay correct because
  the POST response carries refreshed options. Handling the notifications needs a new
  patch kind and WS plumbing — separate change.
- **Boolean options.** Claude's `fast` option is `type: "boolean"`
  (`docs/agent-claude-code.md:205`). Filtered out by the string-`currentValue` rule
  below; `Select` renders string values only. A toggle for it is a later change.
- **Replacing the Model picker.** `/chat/model` keeps its own route, persistence, and
  URL handoff (`openNewChatInNewTab`).

## Backend

### 1. Widen the parse

`parseSessionConfig` keeps three fields it currently drops: `name`, `category`, `type`.
`rawConfigOptions` entries become
`{ id, name?, category?, type?, currentValue?, options: { value?, name? }[] }`.

### 2. Two optional `AgentBackend` methods

In `src/agent/types.ts`, mirroring `getSessionModels` / `setSessionModel`:

```ts
export interface SessionConfigOption {
  id: string;
  name: string;
  category?: string;
  currentValue: string;
  options: Array<{ value: string; name: string }>;
}

getSessionConfigOptions?(sessionId: string): SessionConfigOption[] | null;
setSessionConfigOption?(sessionId: string, configId: string, value: string): Promise<void>;
```

`getSessionConfigOptions` returns an option when all of these hold, **excluding
`id === "model"`** (the Model picker owns that one):

- `type` is `"select"` **or absent** — `type` is optional in the ACP shape and an agent
  that omits it still means a select; keying strictly on `"select"` would drop
  everything from such an agent.
- `currentValue` is a string — this is what actually excludes `fast`-style boolean
  options, whether or not they declare a `type`.
- `options[]` is non-empty — nothing to pick from otherwise.

`name` falls back to `id` when the agent omits it, and each option's `name` falls back to
its `value`, matching how `parseSessionConfig` already builds model labels.

Returns `null` when the backend has no session config at all, so the route can answer
`supported: false`.

### 3. `setSessionConfigOption` in `AcpAgentBackend`

Validates `configId` and `value` against the reported options first (same guard shape as
`setSessionModel`), then dispatches on category:

- **`category === "mode"`** → `session/set_mode { sessionId, modeId: value }`. This is
  the ACP method that exists for modes and is the one confirmed working against the live
  adapter (`docs/agent-claude-code.md:177-180`). Whether that adapter's
  `setSessionConfigOption` handler also accepts `configId: "mode"` is unverified, so we
  don't rely on it. `set_mode` returns no refreshed config, so update
  `ctx.modes.currentModeId` and the mode entry's `currentValue` locally.
- **everything else** → `session/set_config_option { sessionId, configId, value }`.
  The response carries every option with refreshed `currentValue`
  (`docs/agent-claude-code.md:189`) — re-run `parseSessionConfig` on it and adopt the
  result wholesale, including `availableModels` / `currentModelId`, exactly as
  `setSessionModel` does. Values are resolved, not just validated, so never assume the
  requested value stuck.

No legacy fallback: `set_config_option` is the current spelling, and a `-32601` here
means the agent genuinely can't do it.

Set on a session whose query stream has closed throws "session ended"
(`docs/agent-claude-code.md:201-203`) — surfaces as a 400, same as the model picker.

### 4. Routes

Next to `/chat/model` in `src/server.ts`:

- `GET /chat/config-options?sessionId=` →
  `{ ok: true, supported: boolean, options: SessionConfigOption[] }`.
  404 unknown session.
- `POST /chat/config-option { sessionId, configId, value }` →
  `{ ok: true, options: SessionConfigOption[] }` (refreshed).
  404 unknown session, 501 backend can't, 400 unknown configId/value or a rejected set.
  **Rejects `configId: "model"` with 400** pointing at `/chat/model`, so there's one
  source of truth for model.

Both go through `resolveSessionEntry`, like every other session route.

### 5. `/chat/init` carries them

The init response gains `configOptions: SessionConfigOption[]`, so pickers render on load
without a second round trip — same as `backend.model` today.

## Persistence

`session_metadata.json` gains:

```ts
configOverrides?: Record<string /* sessionId */, Record<string /* configId */, string>>;
```

with `getConfigOverrides(sessionId)` and
`setConfigOverride(sessionId, configId, value | null)` on `SessionConfigStore`
(`src/agent/sessionConfigStore.ts`), following `modelOverrides` exactly — a `null` value
deletes the entry.

`POST /chat/config-option` persists whatever the backend *landed on*, not what was asked
for (same reasoning as the model route: a persisted override that disagrees with the
agent gets re-applied and re-resolved on every resume).

On `/chat/init` resume, each stored override is re-applied right after the existing
`storedModel` re-apply — best-effort, logged, never fails init.

**Consequence worth knowing:** a session left in `bypassPermissions` or `plan` comes back
that way after a gateway restart. That is the point of persistence, but it means a mode
chosen once is sticky until changed.

## Frontend

- `frontend/src/api/types.ts` — `ConfigOption` matching the backend shape; `InitResponse`
  gains `configOptions`.
- `ChatContext` — `configOptions: ConfigOption[]` in state, populated from init,
  `setConfigOptions(next)` action.
- `useChat` — `setConfigOption(configId, value)`: POST, then `setConfigOptions` from the
  response. On failure, state is untouched, so the dropdown keeps showing the previous
  value (same behavior as `setModel`).
- `ChatPanel` — passes `configOptions` and `onConfigOptionChange` down.
- `Composer` — after the Model `<Select>`, `configOptions.map()` → one
  `<Select aria-label={opt.name} value={opt.currentValue} …>` each. Empty array renders
  nothing.

No CSS change: `.actionsLeft` is already `flex-wrap: wrap`
(`Composer.module.css:64-69`). With Model + Mode + Effort + Agent the row will wrap on
narrow widths, which is the intended behavior.

Resulting row: attach · **Model** · **Mode** · **Effort** · **Agent** · Auto-approve ·
context pill.

## Interaction with Auto-approve

They're complementary, not overlapping. Auto-approve is jarvis-bridge's *own* answer
policy for incoming `session/request_permission` requests
(`src/agent/acp/index.ts:181-208`); it never touches the ACP mode. Mode decides *who
decides* — in Claude's default `auto` mode a classifier inside the adapter answers and
the request never reaches jarvis-bridge, which makes the Auto-approve toggle inert until
mode is switched to `default` (`docs/agent-claude-code.md:171-175`). Adding the Mode
picker is what makes the existing toggle reachable.

No change to auto-approve code.

## Tests

**Backend** (`node:test`)
- `src/agent/acp/index.test.ts` — parse keeps `name`/`category`/`type`;
  `getSessionConfigOptions` excludes `model` and boolean options;
  `setSessionConfigOption` rejects unknown configId and unknown value;
  non-mode set goes through `session/set_config_option` and adopts the refreshed
  response; mode set goes through `session/set_mode` and updates local state.
- `src/server.test.ts` — `GET /chat/config-options` shape and `supported: false`;
  `POST` sets, persists, and returns refreshed options; 404 unknown session;
  400 unknown configId; 400 for `configId: "model"`; override re-applied on
  `/chat/init` resume.
- `src/agent/sessionConfigStore.test.ts` — `configOverrides` round-trip through disk,
  `null` deletes.

**Frontend** (Vitest)
- `Composer.test.tsx` — renders one Select per config option with the right label and
  current value; selecting fires `onConfigOptionChange(configId, value)`; empty array
  renders only the Model select.
- `ChatContext.test.tsx` — init populates `configOptions`.

## Files touched

```
src/agent/types.ts                     + SessionConfigOption, 2 optional methods
src/agent/acp/index.ts                 parseSessionConfig widened, 2 new methods
src/agent/sessionConfigStore.ts        + configOverrides
src/server.ts                          + 2 routes, init field, resume re-apply
frontend/src/api/types.ts              + ConfigOption
frontend/src/state/ChatContext.tsx     + configOptions state
frontend/src/state/useChat.ts          + setConfigOption
frontend/src/components/ChatPanel.tsx  wiring
frontend/src/components/Composer.tsx   + generic Select loop
```

Plus the five test files above. No change to `vite.config.js` proxy — `/chat` is already
proxied.
