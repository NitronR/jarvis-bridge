# 02 — ACP Agent Backend

This is the core of Jarvis Bridge: the layer that spawns a headless agent CLI and speaks the **Agent
Client Protocol (ACP)** to it. ACP is **JSON-RPC 2.0** framed as **newline-delimited JSON** over the
subprocess's **stdin/stdout**. In ACP terms, the gateway is the *client* and the subprocess is the
*agent*.

The job of this layer is to turn the agent's `session/update` notifications into a backend-agnostic
`ChatPatch` event stream the rest of the app consumes.

Suggested file layout:

```
src/agent/acp/
├── index.ts          AcpAgentBackend + AcpAgentSession (lifecycle, sessions, prompt streaming)
├── jsonrpc.ts        JSON-RPC client over newline-delimited stdio
├── mapping.ts        acpUpdateToPatches: session/update -> ChatPatch
├── prompt-content.ts build ACP prompt blocks (text + images within a byte budget)
└── image-resize.ts   downscale images to fit the transport size cap
```

---

## 1. The wire contract: `ChatPatch`

`ChatPatch` is the incremental event the gateway streams to the browser (one per SSE `data:` line)
and also what it stores per assistant turn to replay history. Define it once and share it.

```ts
type ChatPatch =
  // text (assistant prose) — the FIRST chunk's text rides on `text-start.content`,
  // subsequent chunks arrive as `text-delta`. (Do not assume text-start is empty.)
  | { type: "text-start"; index: number; content: string }
  | { type: "text-delta"; index: number; delta: string }
  // thoughts (reasoning), a separate channel — same first-chunk-on-start rule
  | { type: "thought-start"; index: number; content: string }
  | { type: "thought-delta"; index: number; delta: string }
  // tool calls
  | { type: "tool-call-start"; index: number; toolCallId: string | null; toolName: string; argsInitial: string }
  | { type: "tool-call-name-delta"; index: number; delta: string }     // see note: unused by ACP
  | { type: "tool-call-args-delta"; index: number; delta: string }     // see note: unused by ACP
  | { type: "tool-call-finalized"; index: number; toolCallId: string | null; args: unknown; argsRaw?: string; intent?: string }
  | { type: "tool-return"; toolCallId: string | null; content: unknown }
  | { type: "tool-error"; toolCallId: string | null; content: string }
  | { type: "tool-return-orphan"; toolName?: string; content: unknown }
  // accounting
  | { type: "usage"; usage: UsageTotals }
  | { type: "error"; message: string }   // NOTE: the top-level error uses `message`, but tool-return/tool-error use `content`
  // control-plane (ACP additions)
  | { type: "slash-commands"; commands: Array<{ name: string; description?: string }> }
  | { type: "approval-request"; requestId: string; toolCallId: string | null; toolName: string;
      toolKind?: string; toolInput?: unknown; options: Array<{ id: string; name: string; kind?: string }> }
  | { type: "steer-ack"; accepted: boolean; reason?: string }
  | { type: "images-skipped"; skipped: Array<{ filename?: string; mimeType: string;
      reason: "too-large" | "unsupported" | "decode-error" }> };

interface UsageTotals {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  context_limit?: number;
  context_used?: number;
  // opencode-specific additions (see 10-agent-opencode.md §8):
  //   - `cost` arrives in `usage_update` notifications; absent on most agents.
  //   - `thought_tokens` arrives in the final `session/prompt` result.
  // Drop on the floor if your target agent does not emit them.
  cost?: { amount: number; currency: string };
  thought_tokens?: number;
}
```

Field-naming gotchas (these are the contract — copy them exactly):
- `text-start` / `thought-start` carry the **first** chunk's text in `content`; only later chunks are
  `*-delta`. A renderer that ignores `content` drops the first chunk of every message.
- `tool-call-finalized.args` is the **parsed object** (`unknown`), not a string; `argsRaw?` is the raw
  string fallback (present only when the args weren't valid JSON).
- `tool-return` / `tool-error` / `tool-return-orphan` use **`content`** (not `output`/`message`).
  Only the top-level `error` patch uses `message`.
- `images-skipped` uses **`skipped`** (not `images`); `toolCallId` is `string | null` throughout.
- `tool-call-name-delta` / `tool-call-args-delta` exist in the union but the ACP backend **never
  emits them** — it delivers args via `argsInitial` + `tool-call-finalized`. A generic renderer may
  keep no-op handlers for them.

> Note the snake_case in `UsageTotals` — ACP usage payloads are camelCase; the mapping layer
> normalizes them. The `index` field gives each text/thought/tool item a stable slot so deltas append
> to the right place.

---

## 2. JSON-RPC transport (`jsonrpc.ts`)

A dependency-free JSON-RPC 2.0 client over newline-delimited JSON.

### Framing rules

- Each line on stdout is one JSON-RPC envelope (request, notification, or response).
- **The subprocess interleaves non-JSON log lines** on stdout. Parse each line with `JSON.parse`
  inside a try/catch and silently drop lines that fail or that are not objects with
  `jsonrpc === "2.0"`. This tolerance is essential.
- Buffer partial lines: accumulate stdout chunks, split on `\n`, keep the trailing partial in a
  buffer.

### Error classes

```ts
class AcpRequestError extends Error { code: number; data?: unknown; }      // from a JSON-RPC error response
class AcpConnectionClosedError extends Error { /* subprocess exited / closed */ }
```

### `AcpConnection`

Private constructor; create via a static `spawn`.

```ts
interface AcpSpawnOptions {
  command: string;            // e.g. the agent CLI binary
  args: readonly string[];
  cwd: string;
  stderrLogPath?: string;     // stderr appended here (mkdir -p + createWriteStream "a")
  env?: NodeJS.ProcessEnv;    // defaults to process.env
}
```

Internal state: a numeric `nextId` counter; `pending: Map<string, {resolve, reject}>` keyed by
stringified id; `requestHandlers` and `notificationHandlers` maps; an `exitListeners` set; a `buffer`
string; a `closed` flag.

Behavior:

- **spawn:** create the stderr log file (best-effort; log and continue on failure), spawn with
  `stdio: ["pipe","pipe","pipe"]`, pipe stderr to the log file (or `.resume()` to drain it),
  set stdout to utf-8 and feed it to the line framer, and listen for child `exit`/`error`.
- **Message routing** for each parsed envelope:
  - *Incoming request* (has `method` **and** `id`): look up a registered request handler; if none,
    reply JSON-RPC error `-32601` (method not found). Otherwise await the handler and reply with
    `{ result }`, or on throw reply `-32603` with the message. (This is how the server→client
    requests `session/request_permission` and `elicitation/create` are answered.)
  - *Incoming notification* (`method`, no `id`): invoke the registered handler if any; swallow + log
    handler exceptions.
  - *Incoming response* (`id`, no `method`): pop the matching `pending` entry; reject with
    `AcpRequestError` if `error` present, else resolve with `result`.
- **Exit handling** (idempotent via `closed`): reject all pending requests with
  `AcpConnectionClosedError`, clear the pending map, notify exit listeners, end the stderr stream.
- **Public API:**

```ts
sendRequest<T>(method: string, params?: unknown): Promise<T>;   // allocates id, registers pending, writes line
sendNotification(method: string, params?: unknown): Promise<void>; // fire-and-forget, no id
onRequest(method, handler);      // register server->client request handler
onNotification(method, handler); // register server->client notification handler
onExit(listener);
close();                         // end stdin + kill child; relies on the exit event to set closed
get isClosed(): boolean;
```

> **There is no request timeout at this layer** — a request stays pending until a response arrives or
> the subprocess exits. The only timeout lives in the backend's liveness probe (below).

---

## 3. Backend + session lifecycle (`index.ts`)

Two classes: `AcpAgentSession` (per conversation) and `AcpAgentBackend` (per subprocess connection).

### Constants

```ts
const ACP_PROTOCOL_VERSION = 1;
const CLIENT_INFO = { name: "jarvis-bridge", version: "0.1.0" };
const WRAPPED_USER_MESSAGE_MARKER = "User message: "; // strip the context wrapper on replay
```

### Connection & handshake — `connect()`

1. `AcpConnection.spawn({ command, args, cwd: workspace, stderrLogPath })`.
2. Register the server→client handlers (next section) and an `onExit` listener that logs the exit,
   marks the backend not-alive, and pushes an `{ type: "error", message: "agent subprocess exited" }`
   patch to every active session's live pump (so in-flight iterators surface the failure).
3. Send the ACP `initialize` request and negotiate capabilities:

```ts
// NOTE: `clientCapabilities` shape is AGENT-DEFINED. The example below is one
// valid set; calibrate per your target agent (see 10-agent-opencode.md §3 for
// what opencode expects). Common keys: `fs`, `terminal`, `elicitation`.
const initRes = await conn.sendRequest("initialize", {
  protocolVersion: ACP_PROTOCOL_VERSION,
  clientCapabilities: { elicitation: { form: {} } },
  clientInfo: CLIENT_INFO,
});

// Derive feature flags from the agent's advertised capabilities. NOTE: `extensions`
// and `sessionCapabilities` are OBJECTS/maps keyed by feature name — test with the
// `in` operator (key presence), not array `.includes()`.
const caps = initRes.agentCapabilities ?? {};
supportsSteer  = !!caps.extensions && STEER_EXTENSION_KEY in caps.extensions;
supportsFork   = !!caps.sessionCapabilities && "fork" in caps.sessionCapabilities;
supportsImages = caps.promptCapabilities?.image === true;
```

> **Steering extension note.** Mid-turn steering is an agent-specific *extension* method, advertised
> as a key under `agentCapabilities.extensions`. Treat the exact extension key (`STEER_EXTENSION_KEY`
> above) and its request method name as agent-defined, and gate strictly on the key's presence. If
> your target agent does not advertise it, leave `capabilities.steer = false` and skip the feature.

`capabilities` getter returns a static base (`multipleSessions`, `customWorkingDirectory`, `cancel`,
`toolApprovals` all true) merged with the handshake-derived `steer`, `canFork`, `images`.
`slashCommands` is conservatively false at the backend level (it is really per-session).

### Server→client handlers — `registerHandlers(conn)`

- `session/request_permission` (**request**): if the effective auto-approve for that session is on,
  immediately reply `{ outcome: { outcome: "selected", optionId: "allow_once" } }`. Otherwise route
  to the UI (below).
- `elicitation/create` (**request**): always reply `{ action: "cancel" }` (no structured-input UI).
- `session/update` (**notification**): look up the `SessionContext` by `sessionId`, run
  `acpUpdateToPatches`, capture replay history if currently loading, and push the resulting patches
  to the session's live pump.

### Per-session state (`SessionContext`)

```ts
interface SessionContext {
  busy: boolean;
  cancelRequested: boolean;
  state: AcpStreamState;                 // mapping state machine (below)
  onPatch: ((patches: ChatPatch[]) => void) | null; // active pump while a turn streams
  pendingApprovals: Map<string, { resolve: (optionId: string | null) => void }>;
  // replay capture (during loadSession):
  replayHistory: ChatHistoryEntry[];
  captureReplay: boolean;
  suppressReplayAssistant: boolean;
  lastReplayActivityAt: number;
  // per-session auto-approve override (undefined = inherit backend default):
  autoApproveOverride?: boolean;
  // model info parsed from session/new|load|fork:
  availableModels?: Array<{ modelId: string; name: string }>;
  currentModelId?: string;
}
```

### Session operations (ACP methods)

| Method | ACP call | Notes |
|---|---|---|
| `createSession({cwd,label})` | `session/new { cwd, mcpServers: [] }` | Require a `sessionId` back; **parse `configOptions[]` for models** — opencode (and any standards-compliant agent) returns `configOptions[]` of the form `{ id: "model", currentValue, options: [{value, name}, ...] }`, plus a parallel `mode` option (e.g. `build`/`plan`). A flat `availableModels` / `currentModelId` shape is agent-specific; do not assume it. Cache the parsed list. Optionally pin a configured model via `session/set_model` for **new** sessions only. |
| `loadSession(id,{cwd})` | `session/load { sessionId, cwd, mcpServers: [] }` | Wrap in replay capture (below). If the agent returns a different id, re-key the context. Caches models but does **not** force a configured model (respects the persisted choice). |
| `listSessions()` | `session/list {}` | Map entries to `ChatSessionSummary` (require string `sessionId`; carry `title`, `updatedAt`, `cwd`). |
| `forkSession(id,{cwd})` | `session/fork { sessionId, cwd, mcpServers: [] }` | Gate on `supportsFork`. Returns a brand-new id cloning the source's history. **Full clone only** — any "fork at message" offset is ignored by the agent. |
| `setSessionModel(id, modelId)` | `session/set_model { sessionId, modelId }` | Validate `modelId` against the cached available list; update `currentModelId`. |
| `cancel()` | `session/cancel { sessionId }` (notification) | Fire-and-forget; set `cancelRequested`. |
| `steer(prompt)` | the agent's steer **extension** request | Only when `supportsSteer`; echoes a `steer-ack` patch onto the live stream. |

### The streaming turn — `sendMessage(message, opts?)`

This is the central method. It returns an `AsyncIterable<ChatPatch>` for exactly one turn.

1. **Guards:** if closed or already `busy`, yield an `error` patch and return. Set `busy = true`,
   `cancelRequested = false`.
2. **Reset per-turn state:** clear the mapping indices and per-turn usage, but **preserve** the
   cached slash commands.
3. **Build prompt blocks** (see §4). Default is `[{ type: "text", text: message }]`. With images and
   an image-capable agent, build text + image blocks; yield an `images-skipped` patch for dropped
   attachments; if the build fails outright, yield `error` and stop.
4. **Pump/drain bridge:** create a local `queue: ChatPatch[]` and a `pendingWaiter`. Set
   `ctx.onPatch` to push incoming patches into the queue and wake the waiter. This bridges the async
   notification handler to the synchronous async-iterator.
5. **Abort wiring:** if `opts.signal` is given, on abort call `this.cancel()`.
6. **Issue the prompt:** send the ACP request `session/prompt { sessionId, prompt: blocks }`. Capture
   its promise in a box (`.catch` it so errors become patches, not rejections). When it settles, set
   `turnDone = true` and wake the waiter.
7. **Drain loop:** yield queued patches; when the queue is empty and the turn is not done, await the
   waiter; break when done.
8. **Finalize:** on error, yield `{ type: "error", message }` (map `AcpConnectionClosedError` to a
   friendly "agent connection closed", and suppress cancellation-noise errors when the user
   cancelled). On success, compute a closing `usage` patch from the `session/prompt` result.
   In `finally`, clear `busy`, `onPatch`, and the abort listener.

### Permissions → UI (`routeApprovalToUI`)

Converts an ACP `session/request_permission` into an `approval-request` ChatPatch and awaits the
user's choice:

- If there is no live session / `onPatch`, deny safely (reply with a "reject"-style option).
- Extract `toolCall.toolCallId`, a display `toolName` (`title ?? kind ?? "tool"`), `toolKind`, and
  `toolInput` (prefer `rawInput`, then `input`).
- Map `params.options[]` (each `{ optionId, name, kind? }`) to `{ id, name, kind? }`. If empty, deny.
- Synthesize a `requestId` (e.g. `appr-<ts>-<rand>`), register a `pendingApprovals` entry, and emit
  the `approval-request` patch. Await the resolved choice, then reply
  `{ outcome: { outcome: "selected", optionId } }` (or `{ outcome: { outcome: "cancelled" } }`).

`resolveApproval(requestId, optionId)` (called from the HTTP layer) resolves the parked promise.

### Auto-approve precedence

```
effective(sessionId) = session override (if a boolean is set) ?? backend runtime default
```

- Two tiers at runtime: a per-session override and the backend-wide default. The env var only
  **seeds** the backend default at startup — it is not a separate runtime fallback tier.
- Backend exposes `getDefaultAutoApprove` / `setDefaultAutoApprove` (runtime-mutable so the UI can
  toggle without restart) and `getSessionAutoApproveOverride` / `setSessionAutoApprove(id, value|null)`.
- The env seed is parsed opt-in: only the literal string `"true"` enables it; anything else is
  `false` (safer default = surface an approval modal).

### Healthcheck & liveness

```ts
healthcheck(opts?: { retries?: number }): Promise<{ ok: boolean; detail?: string }>;
```

- Fast path: if alive and the connection is open, run an in-band liveness probe; on success return
  `{ ok: true }`, on failure tear down and fall through to reconnect.
- Reconnect loop: up to `retries` attempts of `connect()`, sleeping a fixed delay between failures;
  return `{ ok: false, detail }` on exhaustion.
- **Liveness probe:** race a `session/list` request against a short timeout (e.g. 1500ms).
  `session/list` is chosen because ACP has no `ping` and it is stateless/side-effect-free. A hung
  subprocess that is still "alive" at the OS level is only detectable this way.

### `close()` (session)

Mark closed, clear the pump, and **resolve all dangling approvals with `null`** so the server's
permission handlers do not hang forever.

---

## 4. Prompt content & image handling

### `prompt-content.ts`

Turns user text + image attachments into the ACP prompt block array.

```ts
type AcpPromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };  // data = base64, no data: prefix

type SkippedImageReason = "too-large" | "unsupported" | "decode-error";
```

`buildAcpPrompt(text, images, options)` returns `{ ok: true, blocks, skipped } | { ok: false, error, skipped }`:

1. Start with a single text block — **omit it entirely for image-only turns** (ACP needs ≥1 block,
   and a blank text block is noise).
2. **Adaptive per-image budget:** one image gets the full single-image budget; multiple images share
   the whole-prompt budget. Reserve space for the base64'd text + ~256 B per image + ~256 B JSON
   overhead; divide the remainder across images, floored at ~8 KiB, capped at the single-image budget.
3. For each image: base64-decode (skip `decode-error` on failure) → fit to budget (see below). On
   failure classify as `too-large` (png/jpeg) or `unsupported` (other mime). On success append an
   image block.
4. **Pre-flight total guard:** measure `JSON.stringify(blocks)` byte length vs the total budget; if
   exceeded, fail client-side (better than hitting the transport cap).

Suggested budgets: single-image ~140 KiB, whole-prompt ~150 KiB. These exist because the ACP
transport caps a single message's size (the agent's local message store rejects oversized messages).
Calibrate to your target agent.

### `image-resize.ts`

Shrinks images so their base64 payload fits a byte budget. Use pure-JS codecs to avoid native deps:
`jpeg-js` (JPEG) and `pngjs` (PNG). `pngjs` ships no types — add a local `src/types/pngjs.d.ts`.

- Only `image/png` and `image/jpeg` are re-encodable. gif/webp/bmp/svg/heic/avif are passed through
  unchanged if they already fit, else skipped (`unsupported`).
- `base64Length(n) = ceil(n/3)*4` (exact base64 expansion).
- Iterate a table of longest-edge caps (e.g. `[1568,1280,1024,768,512,384,256]`) × JPEG qualities
  (e.g. `[80,65,50,35]`), skipping upscales, and return the **first** JPEG whose base64 fits the
  budget. Downscale with a box filter (average source pixels per destination pixel — avoids
  nearest-neighbor aliasing; downscale-only).
- `fitImageToBudget(bytes, mimeType, maxEncodedBytes)`: if the original already fits, return it
  unchanged; if not resizable, return `null`; otherwise run the search. Catch/log decode/encode
  errors and return `null`.

---

## 5. `session/update` → `ChatPatch` mapping (`mapping.ts`)

### Stream state (per session, per turn)

```ts
interface AcpStreamState {
  nextIndex: number;                       // monotonically increasing patch index
  streamingTextIndex: number | null;       // index of the currently open text block
  streamingThoughtIndex: number | null;    // index of the currently open thought block
  toolCallIndexById: Map<string, number>;  // ACP toolCallId -> patch index
  finalizedToolCalls: Set<string>;         // guard: emit tool-call-finalized exactly once
  usage: UsageTotals;
  slashCommands: Array<{ name: string; description?: string }>;
}
```

`resetTurnState(state)` clears everything **except** `slashCommands` (those persist across turns).

### `acpUpdateToPatches(update, state): ChatPatch[]`

Switch on `update.sessionUpdate`:

| ACP `sessionUpdate` | Emitted `ChatPatch` | Notes |
|---|---|---|
| `agent_message_chunk` | `text-start` (first chunk → new index) else `text-delta` | Close any open thought block first. |
| `agent_thought_chunk` | `thought-start` / `thought-delta` | Separate channel; close any open text block. |
| `user_message_chunk` | *(none)* | Close open text/thought; used during replay to recover raw user text. |
| `tool_call` | `tool-call-start` (+ `tool-call-finalized` if `rawInput` already present) | New index; record `toolCallId → index`. `toolName = title ?? kind ?? "tool"`. |
| `tool_call_update` (`completed`) | optional `tool-call-finalized` then `tool-return` | Output prefers `rawOutput`, else extracted text from `content`. |
| `tool_call_update` (`failed`) | optional `tool-call-finalized` then `tool-error` | |
| `tool_call_update` (`in_progress`/`pending`) | *(none)* | |
| `usage_update` | `usage` | Merge into `state.usage`; emit cumulative totals. |
| `available_commands_update` | `slash-commands` | Strip leading `/`; cache in `state.slashCommands`. |
| `current_mode_update`, `session_info_update`, `config_option_update`, unknown | *(none)* | Ignore. |

**Key subtlety:** ACP commonly sends `tool_call` *without* `rawInput`, then a follow-up
`tool_call_update` carrying `rawInput`. The `finalizedToolCalls` set ensures `tool-call-finalized`
is emitted exactly once regardless of which message carries the args.

`usageFromAcp(value)` accepts both camelCase and snake_case keys (`inputTokens`/`input_tokens`,
`outputTokens`, `cachedReadTokens`, `cachedWriteTokens`, and context fields
`contextLimit`/`context_limit`/`size`, `used`/`contextUsed`/`context_used`). Return `null` if all
token counts are zero so empty updates do not emit a patch. `mergeUsage` sums token counts and
prefers the newer context fields.

`patchFromPromptResult(result, state)` turns the final `session/prompt` response into a closing
`usage` patch (or `null`), reading `result.usage` and enriching context fields from any
`result._meta` window-token info.

---

## 6. Replay capture (for `loadSession`)

When loading an existing session, the agent replays its history as `session/update` notifications
(rather than returning it inline). Capture it:

- Wrap the `session/load` call in a "capture window": set `captureReplay = true`, reset replay state,
  run the load, then wait until replay activity has been idle for a short interval (e.g. 75ms,
  polling every 25ms, capped at ~500ms) before turning capture off.
- During capture, reconstruct alternating user/assistant `ChatHistoryEntry` items from the updates.
  Peel the `"User message: "` wrapper off replayed user messages, and **suppress** the assistant turn
  that follows the gateway's hidden context-priming turn (see
  [06-context-and-workspace.md](06-context-and-workspace.md)).
- `consumeReplayHistory()` returns and clears the buffer; the server seeds its per-session history
  from it.

---

## 7. ACP surface summary

**Outgoing (client → agent):**

- `initialize` — handshake; advertise `clientCapabilities: { elicitation: { form: {} } }`.
- `session/new { cwd, mcpServers: [] }`
- `session/load { sessionId, cwd, mcpServers: [] }`
- `session/list {}`
- `session/fork { sessionId, cwd, mcpServers: [] }` (gated on fork capability)
- `session/prompt { sessionId, prompt: [blocks] }`
- `session/set_model { sessionId, modelId }`
- `session/cancel { sessionId }` (notification)
- the steer extension request (gated on the steer capability)

**Incoming (agent → client):**

- `session/update` (notification) — text/thought deltas, tool calls/updates, usage, available
  commands.
- `session/request_permission` (request) — resolved per the effective auto-approve state.
  **Required** — opencode and most ACP agents will invoke this.
- `elicitation/create` (request) — auto-cancelled. **Required** if advertised in
  `clientCapabilities`; otherwise the agent will not call it.
- `fs/read_text_file` / `fs/write_text_file` (request) — **agent-defined opt-in.** Only implement
  if your target agent actually invokes them. opencode uses its own internal `read`/`edit` tools
  regardless of advertised `fs` capability (verified 2026-06-28). See `10-agent-opencode.md` §7.

---

## 8. Implementation checklist

- [ ] Line framing tolerates interleaved non-JSON log lines.
- [ ] Pending requests reject on subprocess exit (`AcpConnectionClosedError`).
- [ ] `initialize` negotiates `steer`/`fork`/`image` capabilities.
- [ ] One turn at a time per session (`busy` guard).
- [ ] `tool-call-finalized` emitted exactly once across the split `tool_call`/`tool_call_update`.
- [ ] Permission requests fail safe when no live stream / no options.
- [ ] Auto-approve precedence: session override → backend default → env default.
- [ ] Image-only prompts omit the empty text block; oversized images are skipped with a reason.
- [ ] Healthcheck reconnects; liveness uses a timed `session/list` probe.
- [ ] `close()` resolves dangling approvals so server handlers do not hang.
- [ ] When `extensions` is absent from `agentCapabilities` (e.g. opencode), `supportsSteer` is
      `false` and the frontend must hide the steer control. See `10-agent-opencode.md` §3.
