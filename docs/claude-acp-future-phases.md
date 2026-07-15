# Claude ACP Backend — Future Phases

This tracks everything explicitly deferred out of Phase 1 (see
`docs/superpowers/specs/2026-07-12-claude-acp-backend-design.md`), so it can be picked
up without re-deriving scope. Not a committed plan — a scoped backlog to brainstorm from
when Phase 1 is done.

## Phase 2 candidates

### `plan` / TODO-list `ChatPatch`
Claude's adapter emits a `plan` sessionUpdate kind (TODO/task-list state from
`TodoWrite`/`TaskCreate`/`TaskUpdate`) that has no `ChatPatch` equivalent today —
`mapping.ts` silently drops it. Needs: a new `ChatPatch` variant, `mapping.ts` handling,
and frontend UI to render a task list. Capability-driven: only backends that ever emit
`plan` need the frontend to render anything; a backend that never sends it just never
triggers the UI.

### Real elicitation handling — **done** (2026-07-15)
`elicitation/create` (`mode: "form"`) now routes to the UI instead of auto-cancelling —
see `docs/agent-claude-code.md` §8 and `docs/archives/2026-07-15-elicitation-support.md`.
`src/agent/acp/index.ts`'s `routeElicitationToUI` mirrors `routeApprovalToUI`: it parses
`requestedSchema` into generic `ElicitationField[]` (`src/agent/acp/mapping.ts`'s
`elicitationSchemaToFields`, protocol-generic — not hardcoded to `AskUserQuestion`'s
shape), emits an `elicitation-request` `ChatPatch`, and resolves via a new
`POST /chat/elicitation` route. The frontend renders it with `ElicitationModal.tsx`
(select / multi-select / free-text fields, Submit → `accept` with content, Skip →
`decline`).

Still not wired: MCP-server-initiated elicitation dialogs and the opt-in
`refusal_fallback_prompt` dialog (retry-on-fallback-model after a refusal) — both use
the same `elicitation/create` request but haven't been probed against a live Claude
backend. They should degrade the same way (`mode` other than `"form"` still hits the
defensive `{action:"cancel"}` fallback in the handler) until someone confirms their
actual shape and builds dedicated UI if needed.

### Terminal-streaming `_meta` channel
Bash tool output can stream live via an opt-in `_meta` channel
(`terminal_info`/`terminal_output`/`terminal_exit`) instead of arriving as a plain
fenced code block on completion. Requires advertising a `_meta` client capability and
wiring streaming updates into the existing tool-call-update UI. Nice-to-have, not
required for parity — the plain-text fallback already works.

### `session/set_mode` + `session/set_config_option` pickers
Phase 1 captures `modes`/`configOptions` data generically (doesn't drop it) but ships no
picker UI. Phase 2: a mode picker (default/plan/acceptEdits/bypassPermissions/auto —
note `bypassPermissions` is conditionally hidden by the adapter itself when running as
root outside a sandbox) and a model/effort/agent/fast-mode picker, both driven by
whatever the connected backend's `configOptions`/`modes` actually contain — no
Claude-specific hardcoding in the picker component itself.

### Per-session backend picker
Phase 1 only exposes a single default-backend setting. A future per-session override
(pick the backend when creating a specific session, not just globally) was explicitly
deferred — the backend-pool registry and `createSession`'s optional `backendName`
param already support this; it's a frontend-only addition (a picker in the new-session
flow) once wanted.

### In-app login flow
Phase 1 requires a pre-authenticated host `~/.claude` credential store (normal `claude`
CLI login done outside jarvis_bridge). A future in-app flow would have jarvis_bridge's
backend spawn the adapter's `--cli auth login --claudeai` subprocess and stream its
interactive prompts/output to the frontend (e.g. via the existing terminal drawer), so
login can happen without leaving the app.

## Open questions to revisit

- Does exploiting native prompt queueing (Phase 1) actually need a "queued messages"
  UI affordance once used in practice, or is invisible FIFO ordering sufficient?
- Once a second backend with a genuinely different tool-call kind vocabulary is live,
  does the frontend's kind→icon/label map need a real update, or does the generic
  fallback hold up well enough that no Phase 2 work is needed there either?
- Is `session/close` worth revisiting if jarvis_bridge ever grows multi-window/multi-tab
  support that shares a session across UI surfaces (the scenario Zed's ref-counted close
  actually solves)?
