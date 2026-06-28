# Session Archive — P2 ACP backend

- **Date:** 2026-06-28
- **Time:** 15:34 IST
- **Branch:** main
- **Commits this session:** `8f7e397 feat(agent): ACP backend over stdio (P2)` (P0 was committed by user as `6228f31` prior to this session)

## Summary

Implemented the **Phase 2 ACP agent backend** for Jarvis Bridge — the heart of the system — using strict TDD. Built on top of the P0 scaffold (TypeScript + Express dev server) that was already committed.

The P2 work spawns an ACP-compatible agent CLI as a subprocess, speaks JSON-RPC 2.0 over newline-delimited stdio, translates the agent's `session/update` notifications into the backend-agnostic `ChatPatch` event stream, and provides session lifecycle, healthcheck, cancel, steer, auto-approve, replay capture, and a per-cwd pool. Verified end-to-end against two custom fake-agent subprocess fixtures (real subprocesses, not mocks of the code under test).

52 tests, all passing; `npm run typecheck` and `npm run build` clean. Full suite takes ~90s due to per-test subprocess spawn overhead.

## Key Decisions

- **Test infrastructure:** Node's built-in `node --test` + `ts-node/register` + `TS_NODE_TRANSPILE_ONLY=true`. Zero new test-framework deps. Tests co-located with source as `*.test.ts`.
- **Fixtures are real subprocesses** (`test/fixtures/fake-agent.cjs`, `fake-streaming-agent.cjs`), not mocks of code under test — avoids the testing-anti-pattern of mocking what you're actually testing.
- **Module resolution quirk discovered:** with ts-node CJS, test files need no extension (`import "./mapping"`), while source files use `.js` for `import type` (type-only imports get stripped, so the `.js` extension only matters in transpile-only mode if used at runtime — best practice is no extension in tests, `.js` for `import type` in source).
- **P1 scope reduction (user-driven):** `initial_workspace/` and `src/context/index.ts` flagged as not needed for now. P1 was never started; this doesn't affect P2.
- **Image resize: box-filter downscale** (averages source pixels per destination pixel) per spec, downscale-only, never upscales. Re-encodes to JPEG across a table of `[1568,1280,1024,768,512,384,256]` × `[80,65,50,35]` quality caps.
- **Auto-approve precedence** (per spec): `session override ?? backend default ?? env seed`. Env seed parsed opt-in (only literal `"true"` enables).
- **Wake-once bug fixed via TDD:** `sendMessage`'s pump initially used a single wake function across loop iterations. After the first notification resolved the promise, subsequent notifications became no-ops because the generator was still suspended at `await`. Fixed by creating a fresh `Promise` per loop iteration.

## Files Modified / Created

### Created (committed in `8f7e397`)

**Source:**
- `src/agent/types.ts` — backend-agnostic contracts
- `src/agent/acp/mapping.ts` — `acpUpdateToPatches`, `usageFromAcp`, `mergeUsage`, `patchFromPromptResult`
- `src/agent/acp/prompt-content.ts` — `buildAcpPrompt` with byte-budget enforcement
- `src/agent/acp/image-resize.ts` — `fitImageToBudget`, `base64EncodedLength`, box-filter downscale
- `src/agent/acp/jsonrpc.ts` — `AcpConnection`, `AcpRequestError`, `AcpConnectionClosedError`
- `src/agent/acp/index.ts` — `AcpAgentBackend`, `AcpAgentSession`
- `src/agent/index.ts` — `createAgentBackend` factory
- `src/agent/backendPool.ts` — `createBackendPool` with in-flight dedup

**Tests (co-located):**
- `src/agent/acp/mapping.test.ts` (20 tests)
- `src/agent/acp/prompt-content.test.ts` (6 tests)
- `src/agent/acp/image-resize.test.ts` (5 tests)
- `src/agent/acp/jsonrpc.test.ts` (8 tests)
- `src/agent/acp/index.test.ts` (5 tests — includes the Done-when integration test)
- `src/agent/backendPool.test.ts` (3 tests)

**Fixtures:**
- `test/fixtures/fake-agent.cjs` — scriptable fake ACP agent (test plan via `X_FAKE_AGENT_PLAN` env var)
- `test/fixtures/fake-streaming-agent.cjs` — streaming-aware fake agent (responds to session/new, session/prompt with text chunks + tool calls + usage, session/list, session/cancel)

### Modified (committed in `8f7e397`)

- `package.json` — added `test` script; `jpeg-js` + `pngjs` runtime deps; `@types/jpeg-js` + `@types/pngjs` dev deps
- `package-lock.json` — lockfile
- `tsconfig.json` — exclude `**/*.test.ts` from build output

### Pre-existing (from earlier P0 work)

- `src/index.ts`, `public/index.html`, `.env.example` — minimal dev server

## Test Summary

```
tests 52
pass  52
fail  0
```

Suites by file:
- `mapping.test.ts` — 20 tests (text/thought channels, tool calls, usage, slash commands, edge cases)
- `prompt-content.test.ts` — 6 tests (text-only, image-only, mixed, decode-error, budget)
- `image-resize.test.ts` — 5 tests (base64 math, fit-already-passes, non-resizable mime, invalid bytes, downscale)
- `jsonrpc.test.ts` — 8 tests (request/response routing, notifications, request handlers, exit/close)
- `index.test.ts` — 5 tests (handshake & capabilities, createSession, healthcheck, streaming turn, cancel)
- `backendPool.test.ts` — 3 tests (default backend, getOrCreate dedup, listSessions)

## Follow-up / Next Steps

1. **P3 — HTTP gateway:** wire the backend into Express with `/chat/init`, `/chat/prime-context`, `/chat/send` (SSE), `/chat/cancel`, `/chat/approval`, `/chat/steer`, `/chat/model`, `/chat/auto-approve`, `/chat/sessions` (+ fork + PATCH), `/workspace/*`, `/skills/*`, `/tools/execute`, event-hooks stub. Bootstrap order: workspace → backend → pool → healthcheck → server → terminal WS.
2. **Add `ws` + `node-pty` deps** (deferred from P0) when P3 lands the terminal drawer.
3. **Test speed:** full suite takes ~90s due to per-test subprocess spawn/teardown. Consider sharing the fake-agent subprocess across a file's tests via `before`/`after` hooks if iteration speed becomes a problem.
4. **End-to-end smoke test with real ACP agent** (e.g. `opencode`) to validate spec interpretation against an actual implementation — P2 was tested against a fake.
5. **Push to remote:** no `origin` remote configured yet. `git remote add origin <url>` when ready.
6. **CI:** add a GitHub Action running `npm run typecheck && npm test` (consider caching `node_modules`).
7. **P1 revisit:** the user flagged `initial_workspace/` and `src/context/index.ts` as not needed. If those turn out to be required for `opencode` integration or for context priming UX, revisit; otherwise keep them out.