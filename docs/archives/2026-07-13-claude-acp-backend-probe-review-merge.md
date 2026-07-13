# Claude ACP Backend — Live Probe, Final Review, and Merge to Main

**Date:** 2026-07-13
**Session ID:** `97ab6391-b2d6-4294-b9eb-f293684051ab` (continued from earlier session `c4e705c2-9038-421b-9855-6f7eaedfc845`)

## Summary of work done

Picked up the Claude ACP backend branch (`feat/claude-acp-backend`, 12 commits from a prior
worktree session covering Tasks 1-10, 12-13 of the implementation plan) and took it from
"code complete" to merged into `main`:

1. **Final whole-branch code review** (commits `14f9ad3..94c8e36`) — found and fixed two
   issues: an unplanned `CLAUDE_MOCK_PROMPT_FLOWS` env injection (capability-model
   violation, hardcoded kind-branch) and the frontend not resetting to a new chat when the
   active session was deleted.
2. **Task 11: live probe** against a real, pre-authenticated `claude` CLI (2.1.207) and
   `@agentclientprotocol/claude-agent-acp@0.58.1`. Hit and diagnosed a real environment bug
   first: this machine is Apple Silicon (M5) but the system Node is an x86_64 build running
   under Rosetta 2, so `npx` resolved the adapter's **`darwin-x64`** bundled native binary
   (Bun-compiled, needs AVX) — which spins at ~99% CPU indefinitely under Rosetta rather than
   crashing. Worked around it with `CLAUDE_CODE_EXECUTABLE` pointed at the user's own working
   `claude` binary (confirmed fast and correct standalone). Documented fully in
   `docs/agent-claude-code.md` §1 so it isn't re-diagnosed from scratch next time.
   - The probe itself caught and fixed **three real bugs**, each with a regression test:
     auto-approve hardcoded `optionId: "allow_once"` instead of matching by `kind` (Claude's
     real "allow once" option has `optionId: "allow"`); `listSessions()` leaking the user's
     entire global Claude Code session history across every project (not scoped to the
     workspace); `deleteSession()` misclassifying a 404 as a 500 because the real "not found"
     detail was nested under `error.data.details`, not the top-level message.
   - Wrote `docs/agent-claude-code.md`, citing the probe transcript throughout.
3. **Second review pass** on the Task 11 diff — found one more **Critical** regression (my
   own earlier `CLAUDE_MOCK_PROMPT_FLOWS` removal had accidentally also removed the
   `env = {...process.env, ...cfg.env}` merge, so any backend profile with a non-empty `env`
   — like the `CLAUDE_CODE_EXECUTABLE` set for the probe — replaced the subprocess's entire
   environment instead of augmenting it, wiping `PATH`/`HOME`), one Important (`listSessions`
   cwd filter used exact string equality instead of `path.resolve()`, so a trailing-slash
   mismatch could hide a user's own sessions), and two Minor findings. All fixed and tested.
4. **Manual verification** — started the backend + frontend dev servers to actually click
   through the feature. Found and fixed one more real bug this way: the new
   `GET/PUT /settings/default-backend` route was never added to `frontend/vite.config.ts`'s
   dev proxy list, so the Settings panel would silently 404 in a fresh dev server despite all
   automated tests passing (tests don't exercise the Vite proxy).
5. **User found a pre-existing, unrelated bug** while testing: the agent reported its cwd as
   the jarvis_bridge worktree directory instead of the configured `JARVIS_BRIDGE_WORKSPACE`.
   Root-caused to `src/server.ts`'s `/chat/init` route only passing an explicit `cwd` to
   `createSession`/`loadSession` when the browser sends `?cwd=` (which it never does by
   default) — otherwise `AcpAgentBackend.createSession`'s fallback (`opts?.cwd ??
   process.cwd()`) uses the **server process's own launch directory**. Confirmed via `git log`
   that this predates the entire branch (introduced `cd3f38e`, 2026-06-28). **Not fixed** —
   deferred (see Follow-ups).
6. **Workspace consolidation.** The main workspace (separate from the worktree) had its own
   substantial uncommitted work sitting since before this session started: a session/load
   replay-history restore feature (URL-persisted `sessionId`, chat history rendered on page
   reload), a collapsible terminal drawer (`Ctrl+\`` toggle, closed by default), and
   document-title sync with the active chat's title — plus untracked plan/spec docs for two
   *other*, not-yet-implemented features (`workspace-picker.md`, `frontend-quiet-signal.md`).
   Consolidated by: stashing the main workspace's tracked changes, fast-forward merging
   `feat/claude-acp-backend` into `main` (clean, since `main` hadn't diverged from the
   branch's base), then reapplying the stash. Two real conflicts (`src/agent/acp/index.ts`,
   `src/server.ts`) — both because the stashed work was based on pre-`BackendRegistry` code.
   Resolved by keeping the registry-based structure while pulling in the *correct*
   `loadSession` session-registration-ordering fix from the stash (the branch's own version
   had silently reintroduced the exact ordering bug `AGENTS.md` already documented as a known
   constraint, because the real fix for it had only ever existed as this uncommitted stash,
   never actually landed as a commit on the base either side forked from).
7. Fixed one incidental gap the merge surfaced: `frontend/src/components/InfoPanel.test.tsx`
   had a hardcoded `ChatState` fixture missing the new required `history` field.
8. Updated `docs/`: `AGENTS.md` (new "Backend configuration" section documenting
   `agents.json`/`settings.json`/`BackendRegistry`; fixed a stale `AGENT_CMD` reference),
   the design spec's status line, and `docs/claude-acp-future-phases.md`'s status line —
   all to reflect that Phase 1 is now merged, not just designed/planned.

## Key decisions made

- Work around the arm64/Rosetta hang via `CLAUDE_CODE_EXECUTABLE` rather than reinstalling
  Node system-wide — least invasive, and it's what `docs/agent-claude-code.md` now documents
  as the fix for anyone else hitting this.
- Auto-approve must select the permission option by `kind`, never by a hardcoded `optionId`
  string — `optionId` is agent-defined and opaque; only `kind` is the stable ACP vocabulary.
- `listSessions()` must filter to the backend's own `cwd` (path-resolved, not exact string
  match) for any agent that reports `cwd` per session — a real privacy boundary, not just a
  UX nicety, since Claude's `session/list` returns global history across all the user's
  projects.
- Merge (not branch-switch) the feature branch into the main workspace, so `main` ends up
  fully caught up and the other uncommitted work continues on top of it there — chosen over
  switching the main workspace onto the feature branch directly, per explicit user choice.
- Elicitation capability: keep advertising `clientCapabilities.elicitation.form`
  unconditionally (no change) — the live probe showed dropping it removes `AskUserQuestion`
  from the model entirely rather than gracefully degrading to a permission-request flow.

## Files modified (session-level highlights; see `git log` on `main` for full detail)

- `src/agent/index.ts`, `src/agent/acp/index.ts`, `src/agent/acp/index.test.ts`,
  `src/agent/backendRegistry.test.ts`, `test/fixtures/fake-streaming-agent.cjs` — the three
  live-probe bug fixes + the env-merge regression fix + the cwd-normalization fix, all with
  regression tests.
- `docs/agent-claude-code.md` — new, comprehensive Claude binding profile from the live probe.
- `frontend/vite.config.ts` — added missing `/settings` dev-proxy entry.
- `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/InfoPanel.test.tsx` — minor
  fixes (dependency array tightening; missing `history` field in a test fixture).
- Merge commit `146e172` on `main`: `src/agent/acp/index.ts`, `src/server.ts` (conflict
  resolution), plus the reapplied stash's `frontend/src/App.tsx`,
  `frontend/src/components/{ChatPanel,TerminalDrawer}.tsx`,
  `frontend/src/state/{ChatContext,useChat}.ts`.
- `AGENTS.md`, `docs/superpowers/specs/2026-07-12-claude-acp-backend-design.md`,
  `docs/claude-acp-future-phases.md` — status/architecture doc updates (this save-session).

## Follow-up tasks / next steps

1. **Pre-existing cwd-fallback bug, still unfixed.** `src/server.ts`'s `/chat/init` (both the
   `createSession` and `loadSession` call sites) should default the agent's `cwd` to the
   configured `workspace` instead of leaving it `undefined` (which falls through to
   `AcpAgentBackend`'s own `process.cwd()` fallback — the *server process's* launch
   directory). Predates this branch entirely (`cd3f38e`, 2026-06-28); affects both backends.
   Was flagged mid-session but the conversation moved to workspace consolidation before a
   fix decision was made.
2. **Git housekeeping.** `git stash@{0}` ("session-load replay-history fix, pre
   Claude-ACP-backend merge") is fully redundant now — its content is committed in `146e172`
   — but a stash-drop was blocked by the auto-mode permission classifier (needs explicit user
   confirmation). The worktree at `.worktrees/feat-claude-acp-backend` also still exists,
   same branch history as `main` now; safe to remove whenever.
3. **Phase 2 backlog** unchanged — see `docs/claude-acp-future-phases.md` (real elicitation
   handling, `plan`/TODO-list `ChatPatch`, per-session backend picker, mode/config-option UI).
4. **Two unrelated, not-yet-implemented feature plans** sit in the main workspace as
   untracked docs: `docs/superpowers/plans/2026-07-13-workspace-picker.md` (native
   folder-picker for starting a new chat in an arbitrary directory — notably adjacent to
   follow-up #1 above, though it doesn't fix that bug) and
   `docs/superpowers/plans/2026-07-13-frontend-quiet-signal.md`. Neither was touched this
   session; both remain to be picked up separately.
