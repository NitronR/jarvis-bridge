import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tokensPath = join(__dirname, "tokens.css");
const tokensCss = readFileSync(tokensPath, "utf-8");
const globalPath = join(__dirname, "global.css");
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
