# Claude ACP Backend Phase 1 Implementation Notes

**Date:** July 13, 2026, 06:21 AM
**Base Commit:** `14f9ad3`
**HEAD Commit:** `94c8e36`

## Summary of Work Done
Successfully executed and implemented 10 tasks out of 13 in the integration plan (`docs/superpowers/plans/2026-07-12-claude-acp-backend-plan.md`):
- **Backend Registry & Pool Routing (Tasks 3-5):** Created `BackendRegistry` to manage multiple pooled backends, lazy-spawning them as needed. Wired registry into index startup and threaded it through `server.ts` routes to dynamically resolve and route sessions to their owning backends.
- **Runtime Default Backend Switching (Task 6):** Added endpoints `DELETE /chat/sessions/:id` and `GET`/`PUT /settings/default-backend` for runtime settings control.
- **ACP Capabilities Extension (Tasks 7-9):**
  - **`sessionDelete`**: Derived from handshake; implemented `deleteSession()` sending `session/delete` RPC and cleaning up internal mapping.
  - **`promptQueueing`**: Implemented a FIFO queue of turn resolvers (`turnQueue`) to relax the busy-gate when the capability is advertised, allowing concurrent messages to stream in order rather than rejecting with "session is busy".
  - **Config Parsing**: Generalized model parsing into `parseSessionConfig` to capture `modes` and `configOptions` from the initialization/new responses.
- **Claude Backend Profile (Task 10):** Set up custom CLI environment options (`CLAUDE_MOCK_PROMPT_FLOWS=true`, `FORCE_COLOR=0`) and backend-aware authentication hint on healthcheck failure. Bumps Node engine floor to `>=22`.
- **Frontend Controls (Tasks 12-13):**
  - Added dropdown default-backend selector in `SettingsPanel.tsx`.
  - Added capability-gated delete button in `PastChatsMenu.tsx`.

*Task 11 (Live Probe against real Claude CLI + docs) was deferred due to manual authentication requirement.*

## Key Decisions Made
- **Mock Registry in Server Tests:** Avoided spawning real subprocesses with command `"true"` in `src/server.test.ts` (which would immediately exit and throw connection closed errors) by instantiating `makeSingleBackendTestRegistry` wrapping `FakeBackend` directly.
- **Queue Cleanup on Session Close:** Extended `AcpAgentSession.close()` to immediately reject any turns waiting in `turnQueue` with `AcpConnectionClosedError`, ensuring no promises are left hanging indefinitely.
- **Environment Inheritance:** Configured subprocess spawning to merge profile environment variables over `process.env` rather than completely replacing the environment object. This ensures crucial path and home directory variables are preserved for the child processes.

## Files Modified
- `src/agent/backendConfig.ts` & `src/agent/backendConfig.test.ts` (Task 1)
- `src/agent/settingsStore.ts` & `src/agent/settingsStore.test.ts` (Task 1)
- `src/agent/types.ts` & `frontend/src/api/types.ts` (Task 2, Task 12)
- `test/fixtures/fakeBackend.ts` (Task 2)
- `src/agent/backendRegistry.ts` & `src/agent/backendRegistry.test.ts` (Task 3, Task 10)
- `src/config.ts`, `src/index.ts` & `.env.example` (Task 4, Task 10)
- `src/stubBackend.ts` (deleted in Task 4)
- `src/server.ts` & `src/server.test.ts` (Task 5, Task 6, Task 13)
- `src/agent/acp/index.ts` & `src/agent/acp/index.test.ts` (Task 7, Task 8, Task 9)
- `test/fixtures/fake-streaming-agent.cjs` (Task 7, Task 8, Task 9)
- `src/agent/backendPool.test.ts` (Task 5 types fix)
- `frontend/src/components/SettingsPanel.tsx` (Task 12)
- `frontend/src/components/PastChatsMenu.tsx`, `frontend/src/components/PastChatsMenu.test.tsx` (Task 13)
- `frontend/src/components/ChatPanel.tsx` (Task 13)
- `.superpowers/sdd/progress.md` (SDD ledger)

## Follow-up Tasks / Next Steps
1. **Manual Live Probe (Task 11):** Run manual probe script against a pre-authenticated `@anthropic-ai/claude-code` or global `claude` CLI, verify wire shapes, and write `docs/agent-claude-code.md`.
2. **Phase 2 Implementation:**
   - Real elicitation handling (`elicitation/create` flow).
   - Render `plan` / TODO-list updates in the UI.
   - Per-session backend selector in new chat flow.
   - Mode / config option selectors in UI.
