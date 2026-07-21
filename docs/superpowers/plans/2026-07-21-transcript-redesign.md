# Transcript Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat transcript to a warm, avatar-based visual style — replace the "You"/"Assistant" text labels with `Avatar`, remove the double-nested box around assistant turns, restyle tool calls to use `Dot` status indicators, and group consecutive same-role messages under one avatar.

**Architecture:** Presentational-only changes to `Message.tsx`, `Timeline.tsx`, and `Transcript.tsx`. No changes to `ChatPatch`, `MessageEntry`, or any chat state/data flow.

**Tech Stack:** React + TypeScript, CSS Modules, Vitest + Testing Library.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-transcript-redesign-design.md`.
- **Dependency: the design-system plan (`docs/superpowers/plans/2026-07-21-design-system.md`)
  must be fully implemented first.** This plan consumes:
  - `Avatar({ role: "user" | "assistant" } & HTMLAttributes<HTMLSpanElement>)` from
    `frontend/src/components/ui/Avatar.tsx` (28px circle, renders "Y"/"AI",
    `aria-label="You"`/`"Assistant"`).
  - `Dot({ status?: "idle" | "ok" | "bad" | "progress" } & HTMLAttributes<HTMLSpanElement>)` from
    `frontend/src/components/ui/Dot.tsx`.
  - Tokens: `--space-1` through `--space-10`, `--font-size-1` through `--font-size-7`,
    `--font-weight-semibold`, `--color-danger-tint`, `--radius-md`, `--radius-sm`.
- No changes to `ChatPatch` / `MessageEntry` types.
- Existing `Message.test.tsx` (error-class-on-root check, user/assistant/error text-content
  checks) and `Transcript.test.tsx` ("renders one Message per entry") must keep passing
  unchanged — verified per task below, not just asserted.
- Run single test files with: `cd frontend && npx vitest run src/path/to/File.test.tsx`.
- Run the full frontend suite with: `cd frontend && npm run test:web`.

---

## Task 1: Add `--radius-bubble` token

**Files:**
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/styles/tokens.test.ts` (extends the file the design-system plan created)

**Interfaces:**
- Produces (consumed by Tasks 2 and 3 below): `--radius-bubble: 16px`.

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe("tokens.css", ...)` block in
`frontend/src/styles/tokens.test.ts` (do not remove the tests already there from the
design-system plan):

```ts
  it("defines --radius-bubble for message bubbles and tool pills", () => {
    expect(tokensCss).toContain("--radius-bubble: 16px");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/styles/tokens.test.ts`
Expected: FAIL — `--radius-bubble` is not yet defined.

- [ ] **Step 3: Add the token**

In `frontend/src/styles/tokens.css`, inside the `:root` block, add this line immediately after
`--radius-full: 999px;`:

```css
  --radius-bubble: 16px; /* component-layer: message bubbles and tool pills (Transcript redesign) */
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/styles/tokens.test.ts`
Expected: PASS (all tests, including the ones from the design-system plan)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/tokens.css frontend/src/styles/tokens.test.ts
git commit -m "feat(frontend): add --radius-bubble token for the transcript redesign"
```

---

## Task 2: `Message` — avatars, grouping prop, remove double-box wrapper

**Files:**
- Modify: `frontend/src/components/Message.tsx`
- Modify: `frontend/src/components/Message.module.css`
- Modify: `frontend/src/components/Message.test.tsx`

**Interfaces:**
- Consumes: `Avatar` (design-system plan Task 3), `--radius-bubble` (Task 1),
  `--space-2/-3/-5/-6/-7`, `--font-size-5`, `--radius-md`, `--color-accent-tint`,
  `--color-accent`, `--color-surface-2` (existing), `--color-border` (existing).
- Produces (consumed by Task 4 below): `Message` gains an optional `showAvatar?: boolean` prop,
  **defaulting to `true`** when omitted.

- [ ] **Step 1: Write the failing tests**

Add these two tests to the existing `describe("<Message>", ...)` block in
`frontend/src/components/Message.test.tsx` (keep the three tests already there):

```tsx
  it("shows the avatar by default", () => {
    const { getByLabelText } = render(<Message entry={{ role: "user", text: "hi" }} />);
    expect(getByLabelText("You")).toBeInTheDocument();
  });

  it("hides the avatar when showAvatar is false", () => {
    const { queryByLabelText } = render(
      <Message entry={{ role: "user", text: "hi" }} showAvatar={false} />,
    );
    expect(queryByLabelText("You")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/components/Message.test.tsx`
Expected: the 3 existing tests PASS, the 2 new ones FAIL (no `aria-label="You"` element exists
yet — `Message` doesn't render `Avatar`).

- [ ] **Step 3: Implement the avatar + grouping prop + remove the double-box wrapper**

Replace the full contents of `frontend/src/components/Message.tsx`:

```tsx
import { Timeline } from "./Timeline";
import { Avatar } from "./ui/Avatar";
import type { ImageAttachment, ChatPatch } from "../api/types";
import styles from "./Message.module.css";

export type MessageEntry =
  | { role: "user"; text: string; images?: ImageAttachment[] }
  | { role: "assistant"; patches: ChatPatch[] };

export function Message({
  entry,
  showAvatar = true,
  onApproval,
  onElicitation,
  onSteerAck,
  onImagesSkipped,
}: {
  entry: MessageEntry;
  showAvatar?: boolean;
  onApproval?: (p: ChatPatch & { type: "approval-request" }) => void;
  onElicitation?: (p: ChatPatch & { type: "elicitation-request" }) => void;
  onSteerAck?: (p: ChatPatch & { type: "steer-ack" }) => void;
  onImagesSkipped?: (p: ChatPatch & { type: "images-skipped" }) => void;
}) {
  const avatarSlot = showAvatar ? (
    <Avatar role={entry.role} />
  ) : (
    <span className={styles.avatarSpacer} aria-hidden="true" />
  );

  if (entry.role === "user") {
    return (
      <div className={`${styles.message} ${styles.user}`}>
        {avatarSlot}
        <div className={styles.column}>
          <div className={styles.bubble}>
            {entry.text && <div>{entry.text}</div>}
            {entry.images && entry.images.length > 0 && (
              <div className={styles.attachments}>
                {entry.images.map((img, idx) => (
                  <img
                    key={idx}
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={img.filename || "image"}
                    title={img.filename}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const hasError = entry.patches.some((p) => p.type === "error");
  return (
    <div className={`${styles.message} ${styles.assistant} ${hasError ? styles.error : ""}`}>
      {avatarSlot}
      <div className={styles.column}>
        <Timeline
          patches={entry.patches}
          onApproval={onApproval}
          onElicitation={onElicitation}
          onSteerAck={onSteerAck}
          onImagesSkipped={onImagesSkipped}
        />
      </div>
    </div>
  );
}
```

Replace the full contents of `frontend/src/components/Message.module.css`:

```css
.message {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6);
}
.message.user {
  flex-direction: row-reverse;
}
/* Kept for test compatibility and as a future hook — the visual error treatment now
   lives in Timeline's .errorMsg (danger-tinted box), since there's no single wrapping
   bubble left around an assistant turn to tint. */
.message.error {
}
.avatarSpacer {
  width: 28px; /* keep in sync with ui/Avatar.module.css's .avatar width */
  height: 28px;
  flex-shrink: 0;
}
.column {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 76%;
  min-width: 0;
}
.message.user .column {
  align-items: flex-end;
}
.bubble {
  border-radius: var(--radius-bubble);
  padding: var(--space-5) var(--space-7);
  font-size: var(--font-size-5);
  line-height: 1.45;
  word-wrap: break-word;
}
.message.user .bubble {
  background: var(--color-accent-tint);
  border: 1px solid var(--color-accent);
  border-bottom-right-radius: var(--radius-md);
}
.attachments {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}
.attachments img {
  max-width: 120px;
  max-height: 120px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/Message.test.tsx`
Expected: PASS (all 5 tests — the 3 pre-existing ones still pass because the root element keeps
its `.message`/`.assistant`/`.error` classes and all original text/image content is still
rendered, just inside the new `.column` wrapper instead of directly in `.bubble`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Message.tsx frontend/src/components/Message.module.css \
        frontend/src/components/Message.test.tsx
git commit -m "feat(frontend): Message renders Avatar, drops the double-box wrapper"
```

---

## Task 3: `Timeline` — Dot-based tool pills, bubble restyle

**Files:**
- Modify: `frontend/src/components/Timeline.tsx`
- Modify: `frontend/src/components/Timeline.module.css`

**Interfaces:**
- Consumes: `Dot` and `DotStatus` (design-system plan Task 2), `--radius-bubble` (Task 1),
  `--space-3/-4/-6/-7`, `--font-size-2/-3/-5`, `--font-weight-semibold`, `--color-danger-tint`,
  `--radius-md` (existing tokens).
- Produces: nothing new — internal restyle only, `Timeline`'s props/exports are unchanged.

No new test file — `Timeline.tsx` has no existing test file today (confirmed: only
`Timeline.module.css` and `Timeline.tsx` exist, no `Timeline.test.tsx`), and this task is a
markup/CSS restyle of an already-untested file. Verification is the full suite run in Step 3
below plus the manual check in Step 4.

- [ ] **Step 1: Update the tool-call rendering**

In `frontend/src/components/Timeline.tsx`, add the import:

```tsx
import { Dot, type DotStatus } from "./ui/Dot";
```

Replace the `case "tool":` block inside `renderBubble`:

```tsx
    case "tool": {
      const status: DotStatus = !b.result ? "progress" : b.result.ok ? "ok" : "bad";
      return (
        <details key={key} className={styles.tool}>
          <summary>
            <Dot status={status} />
            <span className={styles.toolName}>{b.toolName}</span>
          </summary>
          {b.argsText && <pre className={styles.toolArgs}>{b.argsText}</pre>}
          {b.result && (
            <div className={styles.toolResult}>
              <span className={b.result.ok ? styles.ok : styles.err}>
                {b.result.ok ? "ok" : "error"}
              </span>{" "}
              {b.result.text}
            </div>
          )}
        </details>
      );
    }
```

- [ ] **Step 2: Restyle the bubbles in Timeline.module.css**

Replace the full contents of `frontend/src/components/Timeline.module.css`:

```css
.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.text {
  background: var(--color-surface-2);
  border-radius: var(--radius-bubble);
  border-bottom-left-radius: var(--radius-md);
  padding: var(--space-5) var(--space-7);
  font-size: var(--font-size-5);
  line-height: 1.45;
  word-wrap: break-word;
}
.text a, .text a:visited {
  color: var(--color-accent);
  text-decoration: none;
}
.text a:hover { text-decoration: underline; }
.thought {
  font-style: italic;
  color: var(--color-text-muted);
  font-size: var(--font-size-3);
}
.thought summary { cursor: pointer; user-select: none; font-weight: var(--font-weight-semibold); }
.tool {
  background: var(--color-surface-1);
  border-radius: var(--radius-bubble);
  padding: var(--space-4) var(--space-6);
  font-size: var(--font-size-3);
}
.tool summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
  user-select: none;
}
.toolName {
  font-family: var(--font-mono);
  color: var(--color-accent);
  font-weight: var(--font-weight-semibold);
}
.toolArgs {
  margin: var(--space-3) 0 0;
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-all;
  font-size: var(--font-size-2);
}
.toolResult {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}
.ok { color: var(--color-success); }
.err { color: var(--color-danger); }
.usage {
  display: flex;
  gap: var(--space-3);
  color: var(--color-text-muted);
}
.errorMsg {
  background: var(--color-danger-tint);
  color: var(--color-danger);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-bubble);
  border-bottom-left-radius: var(--radius-md);
  padding: var(--space-5) var(--space-7);
}
```

(This drops the old `.toolError`/`.toolInProgress`/`.toolSuccess` border-color classes and the
`.spinner`/`@keyframes spin` rules — status is now conveyed by `Dot`, which owns its own
spinner animation. The `.usage` rule here matches what the design-system plan's Task 5 already
left in place; this step doesn't touch it further.)

- [ ] **Step 3: Run the full frontend suite**

Run: `cd frontend && npm run test:web`
Expected: PASS — no test file references the removed classes
(`toolError`/`toolInProgress`/`toolSuccess`/`spinner`), so nothing should break.

- [ ] **Step 4: Manual check**

Run `npm run dev:web` (per `AGENTS.md`, proxied through the backend dev server), open a chat,
and confirm: tool calls show a colored dot (blue spinner ring while running, green when done,
red on error) instead of a colored border; assistant text renders as a rounded bubble with a
flattened bottom-left corner; thought text has no box around it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Timeline.tsx frontend/src/components/Timeline.module.css
git commit -m "feat(frontend): Timeline tool pills use Dot, bubbles restyled to warm tokens"
```

---

## Task 4: `Transcript` — consecutive-same-role avatar grouping

**Files:**
- Modify: `frontend/src/components/Transcript.tsx`
- Modify: `frontend/src/components/Transcript.test.tsx`

**Interfaces:**
- Consumes: `Message`'s `showAvatar` prop (Task 2).
- Produces: nothing new — internal logic only.

- [ ] **Step 1: Write the failing tests**

Add these two tests to the existing `describe("<Transcript>", ...)` block in
`frontend/src/components/Transcript.test.tsx` (keep the two tests already there):

```tsx
  it("shows the avatar only on the first message of a consecutive same-role run", () => {
    render(
      <Transcript
        entries={[
          { role: "assistant", patches: [{ type: "text-start", index: 0, content: "first" }] },
          { role: "assistant", patches: [{ type: "text-start", index: 0, content: "second" }] },
        ]}
        onApproval={vi.fn()}
        onElicitation={vi.fn()}
        onSteerAck={vi.fn()}
        onImagesSkipped={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText("Assistant")).toHaveLength(1);
  });

  it("shows an avatar on each message when roles alternate", () => {
    render(
      <Transcript
        entries={[
          { role: "user", text: "hi" },
          { role: "assistant", patches: [{ type: "text-start", index: 0, content: "hello" }] },
        ]}
        onApproval={vi.fn()}
        onElicitation={vi.fn()}
        onSteerAck={vi.fn()}
        onImagesSkipped={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText("You")).toHaveLength(1);
    expect(screen.getAllByLabelText("Assistant")).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/components/Transcript.test.tsx`
Expected: the 2 existing tests PASS, the 2 new ones FAIL — `Message` currently defaults
`showAvatar` to `true` unconditionally per-entry (no grouping logic in `Transcript` yet), so both
consecutive assistant messages render their own avatar, making
`screen.getAllByLabelText("Assistant")` return 2, not 1.

- [ ] **Step 3: Implement the grouping logic**

In `frontend/src/components/Transcript.tsx`, replace the `entries.map` block:

```tsx
      {props.entries.map((entry, idx) => (
        <Message
          key={idx}
          entry={entry}
          onApproval={props.onApproval}
          onElicitation={props.onElicitation}
          onSteerAck={props.onSteerAck}
          onImagesSkipped={props.onImagesSkipped}
        />
      ))}
```

with:

```tsx
      {props.entries.map((entry, idx) => (
        <Message
          key={idx}
          entry={entry}
          showAvatar={idx === 0 || props.entries[idx - 1].role !== entry.role}
          onApproval={props.onApproval}
          onElicitation={props.onElicitation}
          onSteerAck={props.onSteerAck}
          onImagesSkipped={props.onImagesSkipped}
        />
      ))}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/Transcript.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test:web`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Transcript.tsx frontend/src/components/Transcript.test.tsx
git commit -m "feat(frontend): Transcript groups consecutive same-role messages under one avatar"
```

---

## Plan Self-Review

**Spec coverage:** Avatars via `Avatar` (Task 2) ✓. Consecutive-message grouping (Task 4) ✓.
Double-box removal (Task 2) ✓. Bubble & tool-pill token styling, `Dot`-based status (Task 3) ✓.
`--radius-bubble` token (Task 1) ✓. Accessibility (`aria-label`s) — inherited from `Avatar`
itself (design-system plan), not re-implemented here ✓. Error state danger-tint — moved to
`Timeline`'s `.errorMsg` since the old wrapping bubble is gone (Task 3), documented in Task 2's
CSS comment ✓. Header/toolbar cleanup — explicitly out of scope (spec's Non-goals) ✓.

**Placeholder scan:** No TBD/TODO; every step has complete code.

**Type consistency:** `Message`'s `showAvatar?: boolean` (Task 2) is consumed by `Transcript`
(Task 4) with the exact same name/type. `Dot`'s `status: DotStatus` values (`"progress" | "ok" |
"bad"`) used in Task 3 match the type exported by the design-system plan's `Dot.tsx` exactly
(`"idle" | "ok" | "bad" | "progress"` — `Timeline` just never passes `"idle"`, which is fine
since it's optional-with-default on the `Dot` side).
