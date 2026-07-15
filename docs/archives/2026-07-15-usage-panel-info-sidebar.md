# Session archive: Usage panel in InfoPanel sidebar

**Date:** 2026-07-15
**Session ID:** c3afdb7d-99af-4e15-9155-e710d18fff0c

## Summary

Added a "Usage" card to the right-hand InfoPanel sidebar, below the existing "Session" card, showing
Claude subscription rate-limit info (five-hour/seven-day window status, utilization %, reset time) plus
session cost. Triggered by the user wanting to surface Claude usage (as seen via the CLI's `/usage`
command / `claude usage` output) inside the Jarvis Bridge UI. Investigated `~/Desktop/opensource` (zed,
claude-agent-acp, claude-code-acp, opencode, acp-ui) first for a prior-art implementation to copy from —
found none; built it from scratch by threading the ACP wire's `_meta["_claude/rateLimit"]` payload
through the existing usage-patch pipeline.

Two real bugs were caught from user-reported screenshots after initial implementation and fixed:

1. **`resetsAt` unit bug:** the Claude SDK's `SDKRateLimitInfo.resetsAt` is Unix epoch **seconds**, not
   milliseconds. Passed straight to `new Date(...)`, this rendered "resets 21 Jan, 21:05" (landing near
   Jan 1970) instead of the real ~5-hours-from-now reset time. Confirmed the unit empirically (reverse
   engineered from the wrong date), then confirmed against the real SDK type file
   (`sdk.d.ts`, found via the npx cache at `~/.npm/_npx/.../@anthropic-ai/claude-agent-sdk/sdk.d.ts` —
   no doc comment on units, but the field name and empirical math were conclusive). Fixed by multiplying
   by 1000 at ingestion in `mapping.ts`'s `rateLimitFromMeta`, so `RateLimitWindow.resetsAt` is honestly
   epoch-ms everywhere downstream.
2. **Layout wrapping:** `"Session (5h)"` next to `"allowed · resets 21 Jan, 21:05"` didn't fit the
   280px sidebar and wrapped mid-word. Restructured to put the reset time on its own smaller, muted line
   below the label/percentage row.

After both fixes, the panel showed the correct reset time but only the bare `status` text ("allowed"),
no percentage. Verified via the real per-session API traffic log (`.logs/<sessionId>.log`) that this is
not a bug — the actual `rate_limit_event` payload for a `status: "allowed"` window genuinely omits
`utilization` entirely. Investigated whether any of the opensource projects surface it differently; found
that `claude-agent-acp` never calls the SDK's richer, actively-queryable `get_usage` control API
(`SDKControlGetUsageRequest`/`Response`, which backs the CLI's own `/usage` command and always includes
`utilization`) — it only forwards the passive `rate_limit_event`. Zed's "rate limit" code turned out to
be an unrelated concept (HTTP 429/retry-after handling), not this subscription usage gauge.

## Key decisions

- **Persist `rate_limits` across turns, not per-turn resets** — `rate_limit_event`s are infrequent
  (only fire when quota status changes), unlike per-turn token counts. `resetTurnState` now explicitly
  preserves `state.usage.rate_limits` across a turn reset (mirroring how `slashCommands` is already
  preserved), and `mergeUsage` merges the `rate_limits` map by key instead of replacing it wholesale,
  since each event only reports one window at a time.
- **`sanitizeUsage` (sessionConfigStore.ts) extended to validate/persist `rate_limits`** so the Usage
  card survives a gateway restart / session reload the same way the existing context-usage bar does via
  `lastUsage`.
- **Left the missing-`utilization` gap unfixed, documented instead.** Patching the upstream
  `claude-agent-acp` package to call `query.getUsage()` would give reliable percentages, but that's a
  third-party dependency spawned via `agents.json`, not part of this repo — user explicitly decided to
  leave it for now rather than take on maintaining a fork/patch.
- Frontend falls back to rendering the bare `status` text (e.g. "allowed") when `utilization` is absent,
  rather than hiding the row or showing a misleading percentage.

## Files modified

- `src/agent/types.ts` — new `RateLimitWindow` interface, `UsageTotals.rate_limits` field.
- `src/agent/acp/mapping.ts` — `_meta` on `AcpUpdate`/`AcpUsageShape`, `rateLimitFromMeta` extraction
  (with the `resetsAt * 1000` fix), `usageFromAcp`'s null-check extended to consider rate-limit presence,
  `mergeUsage` merges `rate_limits` by key, `resetTurnState` preserves `rate_limits` across turns.
- `src/agent/acp/mapping.test.ts` — new tests for rate-limit meta extraction, malformed-meta handling,
  merge-by-key behavior, and reset-preservation; updated the resetsAt regression test for the seconds→ms
  conversion.
- `src/agent/sessionConfigStore.ts` — `sanitizeUsage` validates/persists `rate_limits` per window.
- `src/agent/sessionConfigStore.test.ts` — new tests for `rate_limits` persistence across reload and
  malformed-window rejection.
- `frontend/src/api/types.ts` — mirrored `RateLimitWindow`/`UsageTotals.rate_limits`.
- `frontend/src/components/InfoPanel.tsx` — new "Usage" card (rate-limit windows + session cost),
  `rateLimitLabel`/`formatResetsAt` helpers.
- `frontend/src/components/InfoPanel.module.css` — `.val.warn` (≥80% utilization highlight),
  `.resetNote` (stacked reset-time line).
- `frontend/src/components/InfoPanel.test.tsx` — new tests: no card when no usage, rate-limit rendering
  with cost, status-text fallback when utilization absent, resets-line rendering.
- `frontend/src/components/ChatPanel.tsx` — passes the existing `latestUsage` memo into `InfoPanel` as
  the new `usage` prop.
- `docs/agent-claude-code.md` — new subsection under §6 documenting the confirmed
  `_meta["_claude/rateLimit"]` wire shape, both gotchas above, and the `get_usage` gap; corresponding
  entry added to the §11 "Known gaps" list.

## Follow-up / next steps

- None required — user explicitly deferred the `get_usage`/utilization-completeness gap. If revisited
  later, the path is patching upstream `claude-agent-acp` to call `query.getUsage()` and forward the
  response (see `docs/agent-claude-code.md` §6 for the full writeup).
- Manual UI verification (live Claude session, restart required for backend changes) was done by the
  user via screenshots during the session — not re-verified end-to-end after the final `resetsAt` fix
  landed, only checked via unit tests + log inspection. Worth a final visual confirmation next time a
  `rate_limit_event` fires.
