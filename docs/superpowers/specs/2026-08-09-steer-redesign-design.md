# Steer redesign: cancel-and-run-next

- **Date:** 2026-08-09
- **Session:** c4ac3e8f-8cdc-4732-95ad-7949678e87d9

## Summary

Redesign the Steer feature to use cancel-and-run-next on `promptQueueing`, replacing the dead-code `STEER_EXTENSION_KEY` RPC path that no real ACP agent implements. This makes the Steer button visible and functional for Claude and any other agent that advertises `promptQueueing`.

## Background

The existing steer feature is dead code:

- `capabilities.steer` was gated on a jarvis-bridge invented ACP extension key `"jarvis-bridge/steer"` that no real agent implements — confirmed absent from Claude Code ACP, opencode, and all reference projects.
- `AcpAgentSession.steer()` sent an RPC call that was never answered.
- The Steer button never appeared because `capabilities.steer` was always `false`.

Real agents (Claude, opencode) advertise `promptQueueing: true` instead, meaning they support being queued and cancelled. Claude Code ACP also exposes `interrupt_receipt_v1` — calling `query.interrupt()` cancels the current turn (`stopReason: "cancelled"`) and the next queued message runs. This is the cancel-and-run-next strategy confirmed in `claude-code-acp`'s test suite.

Reference projects (Zed, openclaw) implement steering as a UX layer on top of queueing, not as a distinct wire protocol.

## Design

### Capability detection

**File:** `src/agent/acp/index.ts:170`

Change:
```typescript
// OLD
const steer = hasExtension(caps.extensions, STEER_EXTENSION_KEY);

// NEW: steer is now the same as promptQueueing — any agent that supports
// queueing mid-turn supports steering via cancel-and-run-next.
const steer = promptQueueing;
```

The `STEER_EXTENSION_KEY` constant and the `hasExtension` helper become unused. The `promptQueueing` read at line 174 already exists and is correct.

### Backend route deletion

**File:** `src/server.ts:381-395`

Delete the entire `POST /chat/steer` route. The route no longer has any valid caller.

### Backend session method deletion

**File:** `src/agent/acp/index.ts:42,991-1007`

Delete:
- `STEER_EXTENSION_KEY` constant (line 42)
- `AcpAgentSession.steer()` method (lines 991–1007)

### Frontend: redirect steer to queue

**File:** `frontend/src/state/useChat.ts:258-262`

Delete `sendSteer`. The Steer button's `onSteer` prop is changed to call `enqueueMessage` instead — the same queue used by the Queue button.

Before (conceptual):
```typescript
const sendSteer = useCallback(async (text: string) => {
  if (!ctx.state.sessionId || !ctx.state.capabilities?.steer) return;
  setTranscript((cur) => [...cur, { role: "user", text: "(steer) " + text }]);
  await fetchJSON("/chat/steer", { method: "POST", body: { sessionId: ctx.state.sessionId, prompt: text } });
}, [ctx]);
```

After: `sendSteer` is removed entirely. The Composer's `onSteer` handler calls `enqueueMessage(trimmedText)` directly. See § Frontend component changes below.

### Frontend: remove steer-ack toast handling

**File:** `frontend/src/components/ChatPanel.tsx:235-239`

Delete `onSteerAck` callback and the `steer-ack` toast. Steering no longer has an explicit accept/reject signal — the queue drain is the implicit signal.

**File:** `frontend/src/components/Timeline.tsx:141`

Delete `case "steer-ack":` handler.

**File:** `frontend/src/components/Composer.tsx`

`onSteer` handler changes from calling `sendSteer` to calling `enqueueMessage`. No other behavior changes.

### Frontend: update prop types

**File:** `frontend/src/components/Message.tsx:26`
**File:** `frontend/src/components/Transcript.tsx:15`
**File:** `frontend/src/components/Timeline.tsx:14,34`

Remove `onSteerAck` prop from these components.

**File:** `frontend/src/api/types.ts:86`

Remove `{ type: "steer-ack"; accepted: boolean; reason?: string }` from `ChatPatch` union.

**File:** `src/agent/types.ts:197`

Remove `{ type: "steer-ack"; accepted: boolean; reason?: string }` from `ChatPatch` union.

### Button visibility

**File:** `frontend/src/components/ChatPanel.tsx:645`

The Steer button already renders only when `steerSupported` is true and `busy` is true. After this change, `steerSupported` is true whenever `promptQueueing` is true — so the button becomes visible for Claude and any other `promptQueueing`-capable agent.

### Backend: no `steer-ack` patch emission

No backend code emits `steer-ack` — this patch type was only ever produced by the now-deleted `AcpAgentSession.steer()` method. Verify no other code path produces it; remove from union types if clean.

## What stays the same

- Queue drain logic (`useChat.ts:225-237`) — unchanged, handles steer messages identically to queued messages
- `turnQueue` in backend (`index.ts:832,861,950`) — unchanged
- `/chat/cancel` — unchanged, used by Cancel button
- `AcpAgentSession.cancel()` — unchanged
- `promptQueueing` capability read and `this.capabilities.promptQueueing` — already set correctly
- Queue button (`enqueueMessage`) — unchanged behavior

## UX behavior summary

| State | Action |
|---|---|
| Idle | Steer button hidden (as before) |
| Busy + `promptQueueing` true | Steer button visible |
| Click Steer (busy) | Message enters queue with `queued: true`; transcript shows it with queued styling |
| Current turn finishes | Cancel fires (or not — drain triggers naturally); queued steer message is drained and sent as a new turn |
| Busy + `promptQueueing` false | Steer button hidden; Queue button still works (pure client-side hold) |

## Testing

- Update `src/agent/acp/index.test.ts:40` — capability check no longer uses `STEER_EXTENSION_KEY`; the test that asserts `capabilities.steer === true` should verify against `promptQueueing` instead (or delete if redundant with an existing `promptQueueing` assertion).
- Update `src/server.test.ts:127` — remove or update the `capabilities.steer` assertion.
- Update `frontend/src/components/Composer.test.tsx` — `steerEnabled` tests remain valid since they test Composer's UX behavior, not the backend capability. `sendSteer` mock is removed.
- Update `frontend/src/components/ChatPanel.test.tsx` — remove `steer-ack` mock cases and `onSteerAck` handler mocks.
- Add test: confirm Steer button is visible when `busy=true` and `promptQueueing=true`.

## Files to change

| File | Change |
|---|---|
| `src/agent/acp/index.ts` | Delete `STEER_EXTENSION_KEY`, change `steer` capability to `promptQueueing`, delete `steer()` method |
| `src/agent/types.ts` | Remove `steer-ack` from `ChatPatch` union |
| `src/server.ts` | Delete `/chat/steer` route |
| `src/server.test.ts` | Remove `capabilities.steer` assertion |
| `src/agent/acp/index.test.ts` | Update steer capability test |
| `frontend/src/state/useChat.ts` | Delete `sendSteer` |
| `frontend/src/api/types.ts` | Remove `steer-ack` from `ChatPatch` union |
| `frontend/src/components/ChatPanel.tsx` | Delete `onSteerAck`, remove from Composer props |
| `frontend/src/components/Timeline.tsx` | Delete `steer-ack` case and `onSteerAck` prop |
| `frontend/src/components/Transcript.tsx` | Remove `onSteerAck` prop |
| `frontend/src/components/Message.tsx` | Remove `onSteerAck` prop |
| `frontend/src/components/Composer.tsx` | `onSteer` → `enqueueMessage` |
| `frontend/src/components/Composer.test.tsx` | Remove `sendSteer` mock, update steer tests |
| `frontend/src/components/ChatPanel.test.tsx` | Remove `steer-ack` and `steer` from capability mocks |
| `docs/agent-claude-code.md` | Update § capability table and note about steer |
| `docs/acp-notes.md` | Update `/chat/steer` route note |
