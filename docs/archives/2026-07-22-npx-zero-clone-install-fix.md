# npx zero-clone install: migration check, worktree cleanup, and dependency-placement fix

**Date:** 2026-07-22
**Session ID:** d2b58fdd-f65a-45fd-831d-60df279a8e4a

## Summary

Started by reviewing `docs/archives/2026-07-21-setup-simplification-merge.md` for its
migration/testing steps, confirmed the real `~/.jarvis-bridge-system/` migration had
already been run (state present, populated), confirmed `main` was up to date with
`origin/main`, and removed the now-fully-merged `setup-simplification` worktree +
`worktree-setup-simplification` branch (`fd16aa4` confirmed as an ancestor of `main`
via `git merge-base --is-ancestor`).

The bulk of the session was root-causing and fixing the setup-simplification plan's
never-actually-tested `npx github:<owner>/repo` zero-clone install path, which turned
out to be completely broken for two independent reasons.

## Key decisions / findings

- **README bug:** the npx one-liner read `npx github:bhanu-mac/jarvis_bridge`, but the
  actual git remote is `github.com/NitronR/jarvis-bridge` (different owner, different
  repo-name hyphenation). Fixed to `npx github:NitronR/jarvis-bridge`.
- **`~/.npm/_logs` is unreliable for this kind of investigation.** npm only keeps the
  last 10 debug logs, and other npm activity on the same machine (my own verification
  commands, unrelated background processes) rotated out or interleaved with the logs
  I needed mid-investigation. Switched to having `postinstall` write directly to fixed
  `/tmp/*.log` files (bypassing `~/.npm/_logs` and stdout/stderr entirely) for a clean,
  uncontaminated signal — this was the technique that actually cracked the case each
  time indirect log archaeology failed.
- **First hypothesis was wrong.** Initial diagnosis pointed at `vite.config.ts` being
  transpiled by Vite into a temp `.mjs` file, with Node's ESM resolver failing to find
  `vite` across the extra `node_modules` boundary that npx's on-disk layout introduces
  (`~/.npm/_npx/<hash>/node_modules/jarvis-bridge/...`). Renamed `vite.config.ts` →
  `.js` to skip Vite's on-the-fly TS transpilation — this was a no-op fix. Vite bundles
  *any* config file with imports into a temp file regardless of source extension, so
  the theory was incomplete. Kept the rename anyway since it's a harmless, valid
  simplification on its own merits (verified via `npm run typecheck` / `build:web`).
- **Real root cause:** npm only installs a package's regular `dependencies` — never
  `devDependencies` — when that package is consumed *as a dependency* of another
  project, which is exactly what happens internally for `npx github:owner/repo` (even
  though `jarvis-bridge` is the only "dependency" involved). Additionally, npm
  workspaces (`"workspaces": ["frontend"]`) only resolve when the package **is** the
  top-level project you ran `npm install` in — never when it's nested as someone
  else's dependency. So in the npx scenario, `frontend/node_modules` never gets
  created at all, and neither do any of root's own `devDependencies`. Confirmed via
  direct `require.resolve('vite')` / `import('vite')` probes run from `frontend/`
  inside the actual failing npx install location — `vite` simply wasn't there.
- **Fix:** moved everything `bin/jarvis-bridge.js`'s lazy build (`npm run build` = tsc,
  `npm run build:web` = vite build) actually needs into root's `dependencies`:
  `typescript`, `@types/node`, `@types/express`, `@types/ws`, `@types/pngjs`,
  `@types/jpeg-js`, `vite`, `@vitejs/plugin-react`, `@xterm/xterm`,
  `@xterm/addon-fit`. Removed the now-redundant `vite`/`@vitejs/plugin-react` entries
  from `frontend/package.json`'s own `devDependencies` to keep one source of truth
  (frontend's `@xterm/*` entries were left in place since those are frontend's own
  genuine runtime dependencies, just also duplicated at root for the npx path).
- **Verification approach:** iterating via full `npx github:...` runs was slow (~1-2
  min each, real network fetch) and `~/.npm/_npx/<hash>` cache reuse across repeated
  attempts on the same commit risked masking whether a fix actually worked. Switched
  to a much faster local proxy — `git archive HEAD | tar -x` into a scratch dir, then
  `npm install --omit=dev --no-workspaces` — which reproduces the exact same
  devDependency/workspace-skipping conditions npx creates, in seconds instead of
  minutes. Used this to iterate on the fix, then did one final real `npx
  github:NitronR/jarvis-bridge` run to confirm end-to-end.
- **Diagnostic instrumentation was temporary.** Added and then fully reverted
  file-based tracing in `scripts/setup.js` and `package.json`'s `postinstall` across
  several intermediate commits. The only permanent addition is a legitimate
  `try`/`catch` around `scripts/setup.js`'s CLI entry point that writes any thrown
  error to stderr before exiting — previously an uncaught exception there could exit
  non-zero with no visible message at all.

## Final verification (real, live)

- `npx -y github:NitronR/jarvis-bridge` (fresh `~/.npm/_npx` cache, scratch
  `JARVIS_BRIDGE_WORKSPACE`/`JARVIS_BRIDGE_SYSTEM_DIR`/`PORT`): `tsc` build succeeded,
  `vite build` succeeded (344 modules), setup ran, gateway logged `gateway listening on
  http://localhost:3084`, and `curl http://localhost:3084/health` returned
  `{"ok":true}`.
- Local regression check after each dependency-placement change: `npm run typecheck`,
  `npm run build`, `npm test` (213/213 backend tests) all passed.

## Files modified

- `README.md` — fixed npx one-liner (`bhanu-mac/jarvis_bridge` → `NitronR/jarvis-bridge`).
- `scripts/setup.js` — added permanent `try`/`catch` error-surfacing around the CLI
  entry point (all temporary tracing added/reverted within the session).
- `frontend/vite.config.ts` → renamed to `frontend/vite.config.js` (harmless
  simplification, not the actual fix).
- `frontend/tsconfig.node.json` — updated `include` to match the renamed config file,
  added `allowJs: true`.
- `AGENTS.md` — updated two `vite.config.ts` references to `vite.config.js`.
- `package.json` — moved `typescript`, `@types/node`, `@types/express`, `@types/ws`,
  `@types/pngjs`, `@types/jpeg-js`, `vite`, `@vitejs/plugin-react`, `@xterm/xterm`,
  `@xterm/addon-fit` from `devDependencies` to `dependencies`.
- `frontend/package.json` — removed redundant `vite`/`@vitejs/plugin-react` from
  `devDependencies`.
- `package-lock.json` — regenerated after the dependency moves.

Commits: `b67d0e4`, `55d4d3b`, `536d02c`, `87eed09`, `3040fe9`, `3abd258`, `6d73e5c`,
`afe7d24`, `cf71126`, `6570a6f` (all on `main`, all pushed).

## Follow-up / next steps

- Proposed (pending user confirmation, not yet written): add a note to `AGENTS.md`'s
  "Backend configuration" section documenting that any frontend build-time dependency
  (or runtime dependency the production bundle imports) must live in **root**
  `package.json`'s `dependencies` — not `frontend/package.json`'s, and not
  `devDependencies` anywhere — or the npx zero-clone path will silently break again the
  next time someone adds a new frontend dependency.
- Cleaned up the `setup-simplification` worktree/branch this session
  (`.claude/worktrees/setup-simplification`, `worktree-setup-simplification`) — no
  further action needed there.
- Also noticed but out of scope this session: a `/private/tmp/jb-pre10` git worktree
  marked `prunable` by `git worktree list`, and an unrelated active worktree at
  `.worktrees/feat-claude-acp-backend` — neither touched.
