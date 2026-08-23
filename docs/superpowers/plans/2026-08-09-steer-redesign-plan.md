# Steer Redesign: Cancel-and-Run-Next Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead-code steer feature (fake extension-key detection + `/chat/steer` RPC) with cancel-and-run-next on `promptQueueing`, making the Steer button visible and functional for Claude.

**Architecture:** Gating `capabilities.steer` on `promptQueueing` instead of a fictional extension key. Deleting `STEER_EXTENSION_KEY`, `AcpAgentSession.steer()`, and the `/chat/steer` route. Redirecting the Steer button to call `enqueueMessage` (same queue as the Queue button), relying on the existing cancel-on-busy-false drain behavior. Removing `steer-ack` patch type entirely.

**Tech Stack:** TypeScript (backend + frontend), Vitest (frontend), Node `node:test` (backend)

---

## Task 0: Verify test baseline

Before making any changes, run the full test suite to confirm current state.

- [ ] **Step 1: Run backend tests**

Run: `npm test`
Expected: All tests pass (or pre-existing failures documented)

- [ ] **Step 2: Run frontend tests**

Run: `cd frontend && npx vitest run --no-coverage`
Expected: All tests pass (or pre-existing failures documented)

---

## Task 1: Backend — Update capability detection

**Files:**
- Modify: `src/agent/acp/index.ts:168-176`
- Modify: `src/agent/types.ts:197`
- Modify: `src/agent/acp/index.test.ts` (update test)

**Relevant spec section:** `capability detection`

- [ ] **Step 1: Update the capability detection in `src/agent/acp/index.ts`**

Read lines 160–185 to see the current capability detection block. Change line 176:

```typescript
// OLD (line 176):
this.capabilities.steer = steer;

// NEW: steer is backed by promptQueueing — any agent that can queue
// mid-turn can be steered via cancel-and-run-next.
this.capabilities.steer = promptQueueing;
```

The `const steer = hasExtension(caps.extensions, STEER_EXTENSION_KEY)` at line 170 and the `hasExtension` helper itself remain used for other extension keys (e.g. `canFork`), so do not delete `hasExtension`.

- [ ] **Step 2: Verify the capability detection compiles**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/agent/acp/index.ts
git commit -m "refactor(acp): gate capabilities.steer on promptQueueing"
```

---

## Task 2: Backend — Remove `STEER_EXTENSION_KEY` and `AcpAgentSession.steer()`

**Files:**
- Modify: `src/agent/acp/index.ts:42` (constant), `src/agent/acp/index.ts:991-1007` (method)
- Modify: `src/server.ts:381-395` (route)

**Relevant spec section:** `backend route deletion`, `backend session method deletion`

- [ ] **Step 1: Delete `STEER_EXTENSION_KEY` constant**

Read `src/agent/acp/index.ts:38-46` to see the constants block. Delete line 42:

```typescript
// DELETE this line:
const STEER_EXTENSION_KEY = "jarvis-bridge/steer";
```

- [ ] **Step 2: Delete `AcpAgentSession.steer()` method**

Read `src/agent/acp/index.ts:989-1009` to see the `steer()` method. Delete the entire method (lines 991–1007).

- [ ] **Step 3: Delete `/chat/steer` route from `src/server.ts`**

Read `src/server.ts:378-397` to see the route. Delete the entire `POST /chat/steer` handler (lines 381–395).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Run backend tests**

Run: `npm test -- --test-name-pattern="steer" 2>&1 | head -50`
Expected: Any tests mentioning "steer" fail or are skipped (they reference deleted code)

- [ ] **Step 6: Commit**

```bash
git add src/agent/acp/index.ts src/server.ts
git commit -m "refactor: remove dead STEER_EXTENSION_KEY RPC and /chat/steer route"
```

---

## Task 3: Frontend — Remove `steer-ack` patch type

**Files:**
- Modify: `frontend/src/api/types.ts:86`
- Modify: `src/agent/types.ts:197`

**Relevant spec section:** `frontend prop types`

- [ ] **Step 1: Remove `steer-ack` from `ChatPatch` union in frontend types**

Read `frontend/src/api/types.ts` to find the `ChatPatch` union. Remove this variant:

```typescript
// REMOVE from ChatPatch union:
| { type: "steer-ack"; accepted: boolean; reason?: string }
```

- [ ] **Step 2: Remove `steer-ack` from backend `ChatPatch` union**

Read `src/agent/types.ts:195-200` to find the `ChatPatch` union. Remove the same variant.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/agent/types.ts frontend/src/api/types.ts
git commit -m "types: remove steer-ack from ChatPatch union"
```

---

## Task 4: Frontend — Delete `sendSteer` from `useChat.ts`

**Files:**
- Modify: `frontend/src/state/useChat.ts:258-262`

**Relevant spec section:** `frontend: redirect steer to queue`

- [ ] **Step 1: Read `sendSteer` in useChat.ts**

Read `frontend/src/state/useChat.ts:258-262` to confirm the exact content of `sendSteer`.

- [ ] **Step 2: Delete `sendSteer`**

Remove the entire `sendSteer` callback (lines 258–262).

- [ ] **Step 3: Verify callers are updated**

Search for any remaining references to `sendSteer` in the codebase:
Run: `grep -r "sendSteer" --include="*.ts" --include="*.tsx" frontend/src/`
Expected: No matches (if any remain, they must be updated)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state/useChat.ts
git commit -m "refactor(frontend): remove sendSteer — steer now uses enqueueMessage"
```

---

## Task 5: Frontend — Update Composer's `onSteer` to call `enqueueMessage`

**Files:**
- Modify: `frontend/src/components/Composer.tsx:36,58`
- Modify: `frontend/src/components/ChatPanel.tsx:112,235-239,644-645`

**Relevant spec section:** `frontend component changes`

- [ ] **Step 1: Read the Composer's onSteer prop usage**

Read `Composer.tsx` around lines 36 and 58 to understand how `onSteer` is called.

- [ ] **Step 2: Update Composer's onSteer to call enqueueMessage**

In `Composer.tsx`, change the `onSteer` call site (line 58) from calling `onSteer(trimmed)` (which previously called `sendSteer`) to calling `enqueueMessage(trimmed)`. Since `Composer` receives `onSteer` as a prop, the actual call chain change happens in `ChatPanel.tsx` (see Step 3).

Read `Composer.tsx:50-65` to see the steer handling block:

```typescript
// OLD (Composer.tsx:58):
if (steerEnabled) void onSteer(trimmed);
```

The `Composer` itself doesn't change — it just calls `onSteer(trimmed)` as before. The change is in `ChatPanel` where `onSteer` is wired to `enqueueMessage` instead of `sendSteer`.

- [ ] **Step 3: Rewire `onSteer` in ChatPanel to use `enqueueMessage`**

Read `ChatPanel.tsx` around line 112 (where `steerEnabled` state is) and line 644 (where Composer is rendered with `onSteer`). Find the `onToggleSteer` handler and the `onSteer` prop passed to `Composer`.

In `ChatPanel.tsx`, the `onToggleSteer` callback at line ~113 toggles `steerEnabled`. The `onSteer` prop passed to `Composer` at line ~644 currently calls `sendSteer` (which has been deleted). Change it to call `chat.enqueueMessage` instead.

The `onSteer` prop passed to `Composer` should become:
```typescript
onSteer={(text) => { void chat.enqueueMessage(text); }}
```

Or more directly, if `chat` exposes `enqueueMessage` in its return value:
```typescript
onSteer={(text) => { chat.enqueueMessage(text); }}
```

Read `ChatPanel.tsx:110-120` and `ChatPanel.tsx:640-650` to confirm the exact current code before editing.

- [ ] **Step 4: Remove `onSteerAck` and `steer-ack` toast handling from ChatPanel**

Read `ChatPanel.tsx:235-240` to find `onSteerAck`. Delete it.

- [ ] **Step 5: Remove `onSteerAck` from Composer's props**

In `ChatPanel.tsx`, find where `onSteerAck` is passed to child components (`Composer`, `Timeline`, `Transcript`, `Message`). Remove those props.

- [ ] **Step 6: Verify no remaining `steer-ack` references**

Run: `grep -r "steer-ack\|sendSteer\|onSteerAck" --include="*.ts" --include="*.tsx" frontend/src/`
Expected: No matches

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/components/Composer.tsx
git commit -m "refactor(frontend): wire Steer button to enqueueMessage, remove steer-ack"
```

---

## Task 6: Frontend — Remove `steer-ack` and `onSteerAck` from remaining components

**Files:**
- Modify: `frontend/src/components/Timeline.tsx:14,34,141`
- Modify: `frontend/src/components/Transcript.tsx:15`
- Modify: `frontend/src/components/Message.tsx:26`

**Relevant spec section:** `frontend prop types`

- [ ] **Step 1: Remove `steer-ack` case from Timeline**

Read `Timeline.tsx` lines 140-145 to find the `case "steer-ack":` handler. Delete it.

- [ ] **Step 2: Remove `onSteerAck` prop from Timeline, Transcript, Message**

Read each file to find the `onSteerAck` prop type definitions and usages. Remove them.

- [ ] **Step 3: Verify clean**

Run: `grep -r "steer-ack\|onSteerAck" --include="*.ts" --include="*.tsx" frontend/src/`
Expected: No matches

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Timeline.tsx frontend/src/components/Transcript.tsx frontend/src/components/Message.tsx
git commit -m "refactor(frontend): remove steer-ack and onSteerAck from Timeline, Transcript, Message"
```

---

## Task 7: Update tests

**Files:**
- Modify: `src/agent/acp/index.test.ts` (around line 40)
- Modify: `src/server.test.ts` (around line 127)
- Modify: `frontend/src/components/Composer.test.tsx` (around lines 137, 263-276)
- Modify: `frontend/src/components/ChatPanel.test.tsx` (remove `steer-ack` and `steer` capability from mocks)

**Relevant spec section:** `testing`

- [ ] **Step 1: Update `src/agent/acp/index.test.ts`**

Read `src/agent/acp/index.test.ts:35-45` to find the steer capability assertion. The test at line 40 asserts `capabilities.steer === true`. Since the fake agent backend advertises `promptQueueing` (or can be made to), change the assertion to verify `steer` equals `promptQueueing` instead, or remove it if redundant with an existing `promptQueueing` test.

```typescript
// OLD (line 40):
assert.equal(backend.capabilities.steer, true);

// NEW — verify steer is derived from promptQueueing:
assert.equal(backend.capabilities.steer, backend.capabilities.promptQueueing);
```

- [ ] **Step 2: Update `src/server.test.ts`**

Read `src/server.test.ts:125-130` to find the steer capability assertion. Remove or update it to match the new behavior.

- [ ] **Step 3: Update `Composer.test.tsx`**

Read `Composer.test.tsx` around lines 137 and 263-276 to find the steer-related tests. `sendSteer` mock is removed. The test at line 137 (`it("steers with a quick phrase..."`) calls `onSteer` — verify it still makes sense with the new behavior (it should just call `enqueueMessage` which may not exist in the test mock — update the mock's `chat` return value to include `enqueueMessage`).

Also update the mock `chat` object returned by `useChat` in the test file to remove `sendSteer` and add `enqueueMessage` if needed.

- [ ] **Step 4: Update `ChatPanel.test.tsx`**

Read `ChatPanel.test.tsx` to find all mock objects with `steer-ack` handling and `capabilities.steer`. Remove `onSteerAck` handler from mocks and remove `steer-ack` from capability mocks.

- [ ] **Step 5: Run all tests**

Run: `npm test && cd frontend && npx vitest run --no-coverage`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/agent/acp/index.test.ts src/server.test.ts
git add frontend/src/components/Composer.test.tsx frontend/src/components/ChatPanel.test.tsx
git commit -m "test: update steer-related tests for cancel-and-run-next"
```

---

## Task 8: Update documentation

**Files:**
- Modify: `docs/agent-claude-code.md:99-114`
- Modify: `docs/acp-notes.md:210`

**Relevant spec section:** `files to change`

- [ ] **Step 1: Update `docs/agent-claude-code.md`**

Read `docs/agent-claude-code.md:95-120` to see the current capability table and notes. Update the `promptQueueing` row note (around line 104-114) to explain that steer now uses `promptQueueing` directly (cancel-and-run-next), replacing the old fictional extension key. Add a brief note that `capabilities.steer` is now derived from `promptQueueing`.

- [ ] **Step 2: Update `docs/acp-notes.md`**

Read `docs/acp-notes.md` around line 210 to find the `/chat/steer` route note. Update it to document that the route was removed and steer now uses the queue mechanism.

- [ ] **Step 3: Commit**

```bash
git add docs/agent-claude-code.md docs/acp-notes.md
git commit -m "docs: update steer/promptQueueing documentation"
```

---

## Final verification

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck && cd frontend && npm run typecheck 2>&1 | head -30`
Expected: No errors (frontend may need `npm run typecheck` if it has a separate script — check `frontend/package.json`)

- [ ] **Step 2: Full test suite**

Run: `npm test && cd frontend && npx vitest run --no-coverage 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 3: Verify no remaining dead steer code**

Run: `grep -r "STEER_EXTENSION_KEY\|sendSteer\|/chat/steer\|steer-ack\|onSteerAck" --include="*.ts" --include="*.tsx" src/ frontend/src/`
Expected: No matches

- [ ] **Step 4: Commit any remaining changes**

```bash
git status
git add -A && git commit -m "feat: implement cancel-and-run-next steer on promptQueueing"
```
