# Codex backend support — design → implementation → live probe

- **Date:** 2026-09-10 07:06 IST
- **Type:** Feature + post-mortem of a wire-gotcha the live probe caught
- **Spec:** `docs/superpowers/specs/2026-09-09-codex-backend-design.md`
- **Plan:** `docs/superpowers/plans/2026-09-09-codex-backend.md`

## Summary of work done

Added OpenAI Codex as a first-class jarvis_bridge backend by running the first-party
`@agentclientprotocol/codex-acp` ACP adapter as the backend subprocess — the same pattern
already used for Claude (`@agentclientprotocol/claude-agent-acp`). Codex does not natively
speak ACP (it exposes its own app-server JSON-RPC), so the adapter bridges it.

Flow: brainstormed → wrote design spec → wrote implementation plan → implemented
(TDD, inline execution) → ran a live probe against the user's real `~/.codex` API-key
login. The live probe caught and fixed a real bug.

## Key decisions

- **Use `@agentclientprotocol/codex-acp`** (the ACP adapter) rather than writing a PTY
  transport for the raw `codex exec` CLI. Zero new transport code — the ACP layer handles
  it. Mirrors the existing Claude integration.
- **Reuse `~/.codex` auth** (out-of-band `codex login`); no interactive ACP
  `authenticate`/URL-elicitation flow. Confirmed: a valid API-key login does `initialize`
  with no ACP auth round-trip.
- **Native steering via `_session/steering` RPC** (codex), distinct from Claude/opencode's
  `promptQueueing`-based cancel-and-run-next. New `nativeSteering` capability flag tells the
  frontend which transport the Steer button uses.
- **Deferred:** `usageQuery` for codex; interactive auth; goal/async-task/review extension
  surface; native subagent-session negotiation.

## Bug the live probe caught (post-mortem)

Codex advertises native steering at the **top-level** `_meta` of the `initialize` response
(`initRes._meta.steering.supported`), NOT under `agentCapabilities._meta` where claude's
`promptQueueing` lives. The initial implementation read `caps._meta` and got `false`
silently (no error — the wrong path just yields `undefined`), so `nativeSteering` never
lit up. Fixed in `c607da0` by reading `initRes._meta?.steering?.supported`. Documented as a
gotcha in both `docs/agent-codex.md` §3 and `docs/acp-notes.md`.

## Files modified

Committed (8 commits on `main`):
- `src/agent/types.ts`, `frontend/src/api/types.ts` — `nativeSteering` capability flag
- `src/agent/acp/index.ts` — steering detection + `AcpAgentSession.steer()` (`_session/steering`)
- `src/server.ts` — re-added `POST /chat/steer`
- `frontend/src/components/ChatPanel.tsx` + test — Steer picks native vs queue transport
- `agents.json.example`, `scripts/setup.js` — codex profile
- `docs/agent-codex.md`, `AGENTS.md`, `docs/acp-notes.md`
- `test/fixtures/fake-streaming-agent.cjs`, `src/agent/acp/index.test.ts`, `src/server.test.ts`,
  frontend test fixtures (`ChatPanel.test.tsx`, `InfoPanel.test.tsx`, `useChat.test.tsx`,
  `ChatContext.test.tsx`) — tests + `nativeSteering: false` fixture additions

Also edited (outside repo, not committed): `~/.jarvis-bridge-system/config/agents.json`
— added the codex profile to the runtime config.

## Follow-up tasks / next steps

- **Restart the dev gateway (port 3001)** so the running app picks up the codex backend +
  `/chat/steer` route, then select Codex in the UI.
- **Uncommitted work left in the working tree** (user's pre-existing frontend changes +
  my entangled additions): `useChat.ts` and `useChat.test.tsx` contain both the user's
  in-flight changes AND my `steerMessage` function + test (could not be cleanly separated;
  per decision, they stay uncommitted for the user to fold into their own commit).
  Also uncommitted: `ChatContext.tsx`, `ChatContext.test.tsx`, `api/client.ts`,
  `InfoPanel.test.tsx`. Do NOT `git checkout` these without preserving them.
- **Pre-existing frontend type errors** (not introduced by this session): ~18 in
  `Transcript.test.tsx`/`Transcript.tsx` (`MessageEntry` role) + `InfoPanel.test.tsx`
  (`awaitingInput`), and 2 in `useChat.ts` from the user's in-flight work.
- **Unsigned-user auth path not probed** (the local `~/.codex` login is valid). Expected:
  gateway error → out-of-band `codex login`. Worth a manual check when an unsigned
  environment is available.
- `docs/agent-codex.md` captures the confirmed live probe results (adapter 1.11.0);
  recapture if the adapter version changes.