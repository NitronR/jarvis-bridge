# Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a primitive→semantic→component token layer (spacing scale, type scale, new color primitives) to `tokens.css`, and build four shared presentational primitives (`Dot`, `Avatar`, `Button`, `Pill`) in a new `frontend/src/components/ui/` directory.

**Architecture:** Pure frontend, presentational-only. Tokens land first (everything else depends on them). Each primitive is a standalone `.tsx` + `.module.css` pair with its own test, migrated into at most one existing consumer where a real duplicate already exists (`Sidenav`'s health dot → `Dot`, `Timeline`'s usage tags → `Pill`). No consumer migration is forced beyond that — see Global Constraints.

**Tech Stack:** React + TypeScript (frontend workspace), CSS Modules, Vitest + Testing Library.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-design-system-design.md`.
- No dark/light theme switcher — this plan only adds the token layering, not a theme toggle.
- Token substitutions in existing files (global.css, QuickPhrasesRow) must be **pixel-exact**
  matches to current values — zero visual regression — except one documented delta: Timeline's
  usage-tag text goes from an inherited `11px` to Pill's explicit `--font-size-3` (`12px`) (Task 5).
- **No forced migration of every existing button/pill call site.** This plan migrates exactly
  two real duplicates found during the spec's audit: `Sidenav`'s health dot (→ `Dot`, Task 2)
  and `Timeline`'s usage tags (→ `Pill`, Task 5). `QuickPhrasesRow` gets its raw px/999px values
  swapped for the new tokens (Task 6) but is **not** migrated onto the `<Pill>` component itself
  — its pill has a delete button composed inside a clickable label plus a hidden
  `ResizeObserver`-measured clone tightly coupled to the exact box model of its own `.pill`
  class; forcing it through `Pill`'s generic `children`-only API risks breaking that measurement
  logic for a purely cosmetic gain already achieved by the token swap. This is a deviation from
  the design-system spec's literal "both migrate to consume `<Pill>`" wording, made during
  planning once the component's actual implementation was read — flagged here rather than
  silently followed.
- `Button` is built and tested but **no existing call site is migrated onto it** in this plan
  (per the spec's stated incremental-adoption non-goal). Other files adopt it when next touched.
- Run single test files with: `cd frontend && npx vitest run src/path/to/File.test.tsx`.
- Run the full frontend suite with: `cd frontend && npm run test:web`.

---

## Task 1: Design tokens (spacing scale, type scale, new primitives, component layer)

**Files:**
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/styles/global.css`
- Test: `frontend/src/styles/tokens.test.ts` (new)

**Interfaces:**
- Produces (CSS custom properties, consumed by Tasks 2–6 and by the separate Transcript plan):
  `--space-1` through `--space-10`, `--font-size-1` through `--font-size-7`,
  `--font-weight-regular/medium/semibold/bold`, `--radius-full`, `--color-accent-fg`,
  `--color-success-tint`, `--color-danger-tint`, `--button-primary-bg/-bg-hover/-border/-fg`,
  `--button-danger-border/-fg`, `--pill-neutral/accent/success/danger-bg/-fg`,
  `--dot-idle/ok/bad/progress`, `--avatar-user-bg/-border/-fg`,
  `--avatar-assistant-bg/-border/-fg`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/styles/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const tokensPath = fileURLToPath(new URL("./tokens.css", import.meta.url));
const tokensCss = readFileSync(tokensPath, "utf-8");
const globalPath = fileURLToPath(new URL("./global.css", import.meta.url));
const globalCss = readFileSync(globalPath, "utf-8");

describe("tokens.css", () => {
  it("defines the spacing scale from --space-1 to --space-10", () => {
    for (let i = 1; i <= 10; i++) {
      expect(tokensCss).toContain(`--space-${i}:`);
    }
  });

  it("defines the typography scale from --font-size-1 to --font-size-7", () => {
    for (let i = 1; i <= 7; i++) {
      expect(tokensCss).toContain(`--font-size-${i}:`);
    }
  });

  it("defines font-weight tokens", () => {
    expect(tokensCss).toContain("--font-weight-regular: 400");
    expect(tokensCss).toContain("--font-weight-medium: 500");
    expect(tokensCss).toContain("--font-weight-semibold: 600");
    expect(tokensCss).toContain("--font-weight-bold: 700");
  });

  it("defines --radius-full and the new color/tint primitives", () => {
    expect(tokensCss).toContain("--radius-full: 999px");
    expect(tokensCss).toContain("--color-accent-fg:");
    expect(tokensCss).toContain("--color-success-tint:");
    expect(tokensCss).toContain("--color-danger-tint:");
  });

  it("defines component-layer tokens for button, pill, dot, and avatar", () => {
    for (const token of [
      "--button-primary-bg", "--button-primary-bg-hover", "--button-primary-border", "--button-primary-fg",
      "--button-danger-border", "--button-danger-fg",
      "--pill-neutral-bg", "--pill-neutral-fg", "--pill-accent-bg", "--pill-accent-fg",
      "--pill-success-bg", "--pill-success-fg", "--pill-danger-bg", "--pill-danger-fg",
      "--dot-idle", "--dot-ok", "--dot-bad", "--dot-progress",
      "--avatar-user-bg", "--avatar-user-border", "--avatar-user-fg",
      "--avatar-assistant-bg", "--avatar-assistant-border", "--avatar-assistant-fg",
    ]) {
      expect(tokensCss).toContain(`${token}:`);
    }
  });
});

describe("global.css token wiring", () => {
  it("uses the type-scale token for body font-size instead of a raw value", () => {
    expect(globalCss).toContain("font-size: var(--font-size-5)");
    expect(globalCss).not.toMatch(/body\s*{[^}]*font-size:\s*14px/);
  });

  it("uses the new color-accent-fg token instead of the raw hex on button.primary", () => {
    expect(globalCss).toContain("color: var(--color-accent-fg)");
    expect(globalCss).not.toContain("#001020");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/styles/tokens.test.ts`
Expected: FAIL — `tokensCss` does not contain the new tokens yet, `globalCss` still has the raw `14px`/`#001020` values.

- [ ] **Step 3: Add the tokens**

Replace the contents of `frontend/src/styles/tokens.css` with:

```css
:root {
  --color-bg: #11161b;
  --color-surface-1: #182027;
  --color-surface-2: #202a33;
  --color-surface-3: #2a3640;
  --color-text: #e6edf3;
  --color-text-muted: #8b98a5;
  --color-border: #2c3742;
  --color-border-strong: #4a5862;
  --color-accent: #4ea3ff;
  --color-accent-strong: #2d8cff;
  --color-accent-tint: rgba(78, 163, 255, 0.15);
  --color-accent-fg: #001020;
  --color-success: #3fb950;
  --color-success-tint: rgba(63, 185, 80, 0.15);
  --color-warning: #d29922;
  --color-danger: #f85149;
  --color-danger-tint: rgba(248, 81, 73, 0.15);

  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --font-size-1: 10px;
  --font-size-2: 11px;
  --font-size-3: 12px;
  --font-size-4: 13px;
  --font-size-5: 14px;
  --font-size-6: 15px;
  --font-size-7: 16px;

  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --space-1: 2px;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 10px;
  --space-6: 12px;
  --space-7: 14px;
  --space-8: 16px;
  --space-9: 20px;
  --space-10: 24px;

  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;
  --radius-full: 999px;

  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.3);

  --sidenav-w: 220px;
  --chat-composer-h: 96px;
  --header-h: 44px;

  --button-primary-bg: var(--color-accent);
  --button-primary-bg-hover: var(--color-accent-strong);
  --button-primary-border: var(--color-accent-strong);
  --button-primary-fg: var(--color-accent-fg);
  --button-danger-border: var(--color-danger);
  --button-danger-fg: var(--color-danger);

  --pill-neutral-bg: var(--color-surface-1);
  --pill-neutral-fg: var(--color-text-muted);
  --pill-accent-bg: var(--color-accent-tint);
  --pill-accent-fg: var(--color-accent);
  --pill-success-bg: var(--color-success-tint);
  --pill-success-fg: var(--color-success);
  --pill-danger-bg: var(--color-danger-tint);
  --pill-danger-fg: var(--color-danger);

  --dot-idle: var(--color-text-muted);
  --dot-ok: var(--color-success);
  --dot-bad: var(--color-danger);
  --dot-progress: var(--color-accent);

  --avatar-user-bg: var(--color-accent-tint);
  --avatar-user-border: var(--color-accent);
  --avatar-user-fg: var(--color-accent);
  --avatar-assistant-bg: var(--color-surface-3);
  --avatar-assistant-border: var(--color-border-strong);
  --avatar-assistant-fg: var(--color-text);
}
```

In `frontend/src/styles/global.css`, change line 11 (`font-size: 14px;` inside the `body` rule)
to `font-size: var(--font-size-5);`, and change line 20's `color: #001020;` (inside
`button.primary`) to `color: var(--color-accent-fg);`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/styles/tokens.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Run the full frontend suite to confirm no regressions**

Run: `cd frontend && npm run test:web`
Expected: PASS — token value substitutions are exact, so no existing test should change behavior.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/tokens.css frontend/src/styles/global.css frontend/src/styles/tokens.test.ts
git commit -m "feat(frontend): add spacing/type token scale and component-layer tokens"
```

---

## Task 2: `Dot` component + Sidenav migration

**Files:**
- Create: `frontend/src/components/ui/Dot.tsx`
- Create: `frontend/src/components/ui/Dot.module.css`
- Test: `frontend/src/components/ui/Dot.test.tsx`
- Modify: `frontend/src/components/Sidenav.tsx`
- Modify: `frontend/src/components/Sidenav.module.css`

**Interfaces:**
- Consumes: Task 1's `--dot-idle/ok/bad/progress`, `--color-border`.
- Produces (consumed by `Sidenav.tsx` in this task, and by the separate Transcript plan for
  tool-call status): `Dot({ status?: "idle" | "ok" | "bad" | "progress" } & HTMLAttributes<HTMLSpanElement>)`
  from `frontend/src/components/ui/Dot.tsx`, default `status` is `"idle"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Dot.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Dot } from "./Dot";

describe("<Dot>", () => {
  it("defaults to idle status", () => {
    const { container } = render(<Dot />);
    expect(container.firstElementChild?.className).toMatch(/idle/);
  });

  it("applies the ok class", () => {
    const { container } = render(<Dot status="ok" />);
    expect(container.firstElementChild?.className).toMatch(/ok/);
  });

  it("applies the bad class", () => {
    const { container } = render(<Dot status="bad" />);
    expect(container.firstElementChild?.className).toMatch(/bad/);
  });

  it("applies the progress class", () => {
    const { container } = render(<Dot status="progress" />);
    expect(container.firstElementChild?.className).toMatch(/progress/);
  });

  it("forwards arbitrary props like data-testid", () => {
    const { getByTestId } = render(<Dot status="ok" data-testid="health-dot" />);
    expect(getByTestId("health-dot")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ui/Dot.test.tsx`
Expected: FAIL with "Cannot find module './Dot'"

- [ ] **Step 3: Implement `Dot`**

Create `frontend/src/components/ui/Dot.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import styles from "./Dot.module.css";

export type DotStatus = "idle" | "ok" | "bad" | "progress";

export interface DotProps extends HTMLAttributes<HTMLSpanElement> {
  status?: DotStatus;
}

export function Dot({ status = "idle", className, ...rest }: DotProps) {
  return (
    <span
      className={[styles.dot, styles[status], className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
```

Create `frontend/src/components/ui/Dot.module.css`:

```css
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.idle { background: var(--dot-idle); }
.ok { background: var(--dot-ok); }
.bad { background: var(--dot-bad); }
.progress {
  background: transparent;
  border: 2px solid var(--color-border);
  border-top-color: var(--dot-progress);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ui/Dot.test.tsx`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Migrate Sidenav to use `Dot`**

In `frontend/src/components/Sidenav.tsx`, add the import:

```tsx
import { Dot } from "./ui/Dot";
```

Replace:

```tsx
  const dotClass =
    healthOk === null ? styles.dot
    : healthOk ? `${styles.dot} ${styles.ok}`
    : `${styles.dot} ${styles.bad}`;
```

with:

```tsx
  const healthStatus = healthOk === null ? "idle" : healthOk ? "ok" : "bad";
```

Replace:

```tsx
        <span data-testid="health-dot" className={dotClass} />
```

with:

```tsx
        <Dot status={healthStatus} data-testid="health-dot" />
```

In `frontend/src/components/Sidenav.module.css`, delete the now-unused block:

```css
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.dot.ok { background: var(--color-success); }
.dot.bad { background: var(--color-danger); }
```

- [ ] **Step 6: Run Sidenav's existing tests to confirm no regression**

Run: `cd frontend && npx vitest run src/components/Sidenav.test.tsx`
Expected: PASS (all 7 existing tests — they query `[data-testid="health-dot"]` and assert the
className matches `/ok/` or `/bad/`, both of which `Dot`'s CSS-module class names still satisfy).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/Dot.tsx frontend/src/components/ui/Dot.module.css \
        frontend/src/components/ui/Dot.test.tsx frontend/src/components/Sidenav.tsx \
        frontend/src/components/Sidenav.module.css
git commit -m "feat(frontend): add Dot primitive, migrate Sidenav health indicator onto it"
```

---

## Task 3: `Avatar` component

**Files:**
- Create: `frontend/src/components/ui/Avatar.tsx`
- Create: `frontend/src/components/ui/Avatar.module.css`
- Test: `frontend/src/components/ui/Avatar.test.tsx`

**Interfaces:**
- Consumes: Task 1's `--avatar-user-bg/-border/-fg`, `--avatar-assistant-bg/-border/-fg`,
  `--font-size-2`, `--font-weight-semibold`.
- Produces (consumed by the separate Transcript plan): `Avatar({ role: "user" | "assistant" } &
  HTMLAttributes<HTMLSpanElement>)` from `frontend/src/components/ui/Avatar.tsx`. Renders "Y" /
  "AI" initials and sets `aria-label="You"` / `aria-label="Assistant"`.

No existing consumer to migrate — this task builds and tests `Avatar` standalone.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Avatar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("<Avatar>", () => {
  it("renders the Y initial and You aria-label for the user role", () => {
    const { getByLabelText } = render(<Avatar role="user" />);
    expect(getByLabelText("You").textContent).toBe("Y");
  });

  it("renders the AI initial and Assistant aria-label for the assistant role", () => {
    const { getByLabelText } = render(<Avatar role="assistant" />);
    expect(getByLabelText("Assistant").textContent).toBe("AI");
  });

  it("applies the role-specific class", () => {
    const { container } = render(<Avatar role="assistant" />);
    expect(container.firstElementChild?.className).toMatch(/assistant/);
  });

  it("forwards arbitrary props like data-testid", () => {
    const { getByTestId } = render(<Avatar role="user" data-testid="msg-avatar" />);
    expect(getByTestId("msg-avatar")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ui/Avatar.test.tsx`
Expected: FAIL with "Cannot find module './Avatar'"

- [ ] **Step 3: Implement `Avatar`**

Create `frontend/src/components/ui/Avatar.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import styles from "./Avatar.module.css";

export type AvatarRole = "user" | "assistant";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  role: AvatarRole;
}

const INITIAL: Record<AvatarRole, string> = { user: "Y", assistant: "AI" };
const LABEL: Record<AvatarRole, string> = { user: "You", assistant: "Assistant" };

export function Avatar({ role, className, ...rest }: AvatarProps) {
  return (
    <span
      className={[styles.avatar, styles[role], className].filter(Boolean).join(" ")}
      aria-label={LABEL[role]}
      {...rest}
    >
      {INITIAL[role]}
    </span>
  );
}
```

Create `frontend/src/components/ui/Avatar.module.css`:

```css
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-semibold);
  border: 1px solid transparent;
}
.user {
  background: var(--avatar-user-bg);
  border-color: var(--avatar-user-border);
  color: var(--avatar-user-fg);
}
.assistant {
  background: var(--avatar-assistant-bg);
  border-color: var(--avatar-assistant-border);
  color: var(--avatar-assistant-fg);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ui/Avatar.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Avatar.tsx frontend/src/components/ui/Avatar.module.css \
        frontend/src/components/ui/Avatar.test.tsx
git commit -m "feat(frontend): add Avatar primitive"
```

---

## Task 4: `Button` component

**Files:**
- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/src/components/ui/Button.module.css`
- Test: `frontend/src/components/ui/Button.test.tsx`

**Interfaces:**
- Consumes: Task 1's `--button-primary-*`, `--button-danger-*`, `--space-2`, `--space-5`,
  `--font-weight-semibold`, plus existing `--color-border`, `--color-border-strong`,
  `--color-surface-1`, `--radius-sm`.
- Produces (not consumed by any task in this plan — no call site migration; available for
  future files to adopt): `Button({ variant?: "default" | "primary" | "danger" } &
  ButtonHTMLAttributes<HTMLButtonElement>)` from `frontend/src/components/ui/Button.tsx`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Button.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("<Button>", () => {
  it("renders children and responds to clicks", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies the primary variant class", () => {
    render(<Button variant="primary">Send</Button>);
    expect(screen.getByRole("button", { name: "Send" }).className).toMatch(/primary/);
  });

  it("applies the danger variant class", () => {
    render(<Button variant="danger">Stop</Button>);
    expect(screen.getByRole("button", { name: "Stop" }).className).toMatch(/danger/);
  });

  it("applies no variant class for the default variant", () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" }).className).not.toMatch(/primary|danger/);
  });

  it("respects the disabled prop", () => {
    render(<Button disabled>Send</Button>);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ui/Button.test.tsx`
Expected: FAIL with "Cannot find module './Button'"

- [ ] **Step 3: Implement `Button`**

Create `frontend/src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "default" | "primary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "default", className, ...rest }: ButtonProps) {
  const variantClass = variant !== "default" ? styles[variant] : "";
  return (
    <button
      className={[styles.button, variantClass, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
```

Create `frontend/src/components/ui/Button.module.css`:

```css
.button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-5);
  cursor: pointer;
}
.button:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  background: var(--color-surface-1);
}
.button:disabled { opacity: 0.5; cursor: not-allowed; }
.primary {
  background: var(--button-primary-bg);
  border-color: var(--button-primary-border);
  color: var(--button-primary-fg);
  font-weight: var(--font-weight-semibold);
}
.primary:hover:not(:disabled) { background: var(--button-primary-bg-hover); }
.danger {
  border-color: var(--button-danger-border);
  color: var(--button-danger-fg);
}
```

(`var(--space-2) var(--space-5)` = `4px 10px`, identical to `global.css`'s current `button`
padding — this component renders pixel-identically to the existing raw `<button>` styling.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ui/Button.test.tsx`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Button.tsx frontend/src/components/ui/Button.module.css \
        frontend/src/components/ui/Button.test.tsx
git commit -m "feat(frontend): add Button primitive"
```

---

## Task 5: `Pill` component + Timeline usage-tag migration

**Files:**
- Create: `frontend/src/components/ui/Pill.tsx`
- Create: `frontend/src/components/ui/Pill.module.css`
- Test: `frontend/src/components/ui/Pill.test.tsx`
- Modify: `frontend/src/components/Timeline.tsx`
- Modify: `frontend/src/components/Timeline.module.css`

**Interfaces:**
- Consumes: Task 1's `--pill-neutral/accent/success/danger-bg/-fg`, `--radius-full`,
  `--space-1`, `--space-2`, `--space-6`, `--font-size-3`.
- Produces (consumed by `Timeline.tsx` in this task; available for future adoption elsewhere):
  `Pill({ tone?: "neutral" | "accent" | "success" | "danger"; children: ReactNode } &
  HTMLAttributes<HTMLSpanElement>)` from `frontend/src/components/ui/Pill.tsx`, default `tone`
  is `"neutral"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Pill.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "./Pill";

describe("<Pill>", () => {
  it("renders its children", () => {
    render(<Pill>in 120</Pill>);
    expect(screen.getByText("in 120")).toBeInTheDocument();
  });

  it("defaults to the neutral tone", () => {
    render(<Pill>in 120</Pill>);
    expect(screen.getByText("in 120").className).toMatch(/neutral/);
  });

  it("applies the requested tone", () => {
    render(<Pill tone="danger">error</Pill>);
    expect(screen.getByText("error").className).toMatch(/danger/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ui/Pill.test.tsx`
Expected: FAIL with "Cannot find module './Pill'"

- [ ] **Step 3: Implement `Pill`**

Create `frontend/src/components/ui/Pill.tsx`:

```tsx
import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Pill.module.css";

export type PillTone = "neutral" | "accent" | "success" | "danger";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  children: ReactNode;
}

export function Pill({ tone = "neutral", className, children, ...rest }: PillProps) {
  return (
    <span className={[styles.pill, styles[tone], className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </span>
  );
}
```

Create `frontend/src/components/ui/Pill.module.css`:

```css
.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-6);
  font-size: var(--font-size-3);
  white-space: nowrap;
}
.neutral { background: var(--pill-neutral-bg); color: var(--pill-neutral-fg); }
.accent { background: var(--pill-accent-bg); color: var(--pill-accent-fg); }
.success { background: var(--pill-success-bg); color: var(--pill-success-fg); }
.danger { background: var(--pill-danger-bg); color: var(--pill-danger-fg); }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ui/Pill.test.tsx`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Migrate Timeline's usage tags to `Pill`**

In `frontend/src/components/Timeline.tsx`, add the import:

```tsx
import { Pill } from "./ui/Pill";
```

Replace:

```tsx
      {state.usage && (
        <div className={styles.usage}>
          {usagePills(state.usage).map((s, i) => <span key={i}>{s}</span>)}
        </div>
      )}
```

with:

```tsx
      {state.usage && (
        <div className={styles.usage}>
          {usagePills(state.usage).map((s, i) => <Pill key={i} tone="neutral">{s}</Pill>)}
        </div>
      )}
```

In `frontend/src/components/Timeline.module.css`, replace:

```css
.usage {
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
}
.usage span {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 1px 8px;
}
```

with:

```css
.usage {
  display: flex;
  gap: var(--space-3);
  color: var(--color-text-muted);
}
```

(The `.usage span` block is deleted — `Pill` owns that styling now. Note: usage-tag text was
previously `11px`, inherited from `.usage`'s `font-size: 11px`; `Pill` sets its own
`font-size: var(--font-size-3)` (`12px`), so usage tags render 1px larger. This is the one
documented visual delta from Global Constraints, not a regression to fix.)

- [ ] **Step 6: Run the full frontend suite to confirm no regressions**

Run: `cd frontend && npm run test:web`
Expected: PASS — `Timeline.tsx` has no existing test file, so there's nothing to regress there;
this run confirms nothing else broke.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/Pill.tsx frontend/src/components/ui/Pill.module.css \
        frontend/src/components/ui/Pill.test.tsx frontend/src/components/Timeline.tsx \
        frontend/src/components/Timeline.module.css
git commit -m "feat(frontend): add Pill primitive, migrate Timeline usage tags onto it"
```

---

## Task 6: QuickPhrasesRow token-only migration

**Files:**
- Modify: `frontend/src/components/QuickPhrasesRow.module.css`

**Interfaces:**
- Consumes: Task 1's `--radius-full`, `--space-1/-2/-3/-4/-5`, `--font-size-3/-4`.
- Produces: nothing new — this task only replaces raw px/`999px` values in an existing file
  with their exact token equivalents (see Global Constraints for why this file does not adopt
  the `<Pill>` component itself).

- [ ] **Step 1: Replace hardcoded values with tokens**

In `frontend/src/components/QuickPhrasesRow.module.css`, apply these exact substitutions
(every new value is pixel-identical to what it replaces):

```css
.row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  position: relative;
}
.addWrap { flex-shrink: 0; }
.addButton {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  min-width: 0;
  padding: 0;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background: var(--color-surface-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-5);
  line-height: 1;
  cursor: pointer;
}
.addInput {
  height: 22px;
  min-width: 140px;
  font-size: var(--font-size-3);
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-2);
  color: var(--color-text);
}
.pill {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-5);
  font-size: var(--font-size-3);
  flex-shrink: 0;
  white-space: nowrap;
}
.pillText {
  background: none;
  border: none;
  padding: 0;
  min-width: 0;
  font-size: var(--font-size-3);
  color: var(--color-text);
  cursor: pointer;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.delete {
  background: none;
  border: none;
  padding: 0 var(--space-2);
  min-width: 0;
  line-height: 1;
  font-size: var(--font-size-4);
  color: var(--color-danger);
  cursor: pointer;
}
.overflow {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-4);
  font-size: var(--font-size-3);
  flex-shrink: 0;
  color: var(--color-text-muted);
}
.overflowPopup {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  z-index: 10;
  min-width: 160px;
}
.overflowPopup .pill { width: 100%; }
.measure {
  position: absolute;
  visibility: hidden;
  height: 0;
  overflow: hidden;
  display: flex;
  gap: var(--space-2);
  white-space: nowrap;
  pointer-events: none;
  top: 0;
  left: 0;
}
```

- [ ] **Step 2: Run QuickPhrasesRow's existing tests to confirm no regression**

Run: `cd frontend && npx vitest run src/components/QuickPhrasesRow.test.tsx`
Expected: PASS (all 8 existing tests — none assert on exact pixel values, and every
substitution above is value-identical to what it replaces, so the `ResizeObserver`-based
width measurement in `QuickPhrasesRow.tsx` is unaffected).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/QuickPhrasesRow.module.css
git commit -m "refactor(frontend): migrate QuickPhrasesRow onto spacing/radius/type tokens"
```

---

## Plan Self-Review

**Spec coverage:** Token layers (Task 1) ✓. Spacing scale (Task 1) ✓. Typography scale (Task 1)
✓. `Button` (Task 4) ✓. `Pill` + migration of the two identified duplicates (Task 5, Task 6 for
tokens-only) ✓. `Dot` + Sidenav migration (Task 2) ✓. `Avatar` (Task 3) ✓. The spec's literal
"QuickPhrasesRow migrates to `<Pill>`" is **not** implemented as written — deviation documented
in Global Constraints and Task 6, with rationale grounded in the component's actual
implementation (delete button + ResizeObserver measurement).

**Placeholder scan:** No TBD/TODO; every step has real, complete code.

**Type consistency:** `Dot`'s `status` prop (`"idle" | "ok" | "bad" | "progress"`) and
`Avatar`'s `role` prop (`"user" | "assistant"`) are defined once in Tasks 2–3 and referenced
identically in this plan's own Interfaces sections — these are the exact signatures the
separate Transcript plan consumes.
