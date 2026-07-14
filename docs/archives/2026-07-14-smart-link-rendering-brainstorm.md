# Smart-link rendering brainstorming (incomplete)

**Date:** 2026-07-14
**Session:** user pivoted mid-brainstorm — conversation interrupted before design was finalized or implementation began.

## Context

User asked: "can we do smart rendering of links in the chat messages similar to how confluence and jira does."

A brainstorming session was initiated to scope the feature and present a design before implementation. Several clarifying questions were resolved; the session was paused before the design could be written or implementation could start.

## Current chat-message rendering state (baseline)

From exploration of the codebase:

- Assistant messages render through `react-markdown` + `remark-gfm` + `rehype-sanitize` (`frontend/src/markdown.tsx`). Inline `[text](url)` and bare URLs (`https://...`) become clickable links automatically — no metadata, no preview.
- User messages are plain text (`<div>{entry.text}</div>` in `Message.tsx`) — URLs are displayed as raw text and not clickable.
- No link preview / Open Graph metadata is fetched anywhere. No link-cards or smart-link components exist.
- Markdown libraries live in root `package.json`: `react-markdown@^9.1.0`, `remark-gfm@^4.0.1`, `rehype-sanitize@^6.0.0`.

## Resolved scoping decisions (from brainstorming)

1. **Link categories to support:**
   - Generic URL previews (Open Graph metadata: title, description, thumbnail)
   - File/PR references in the codebase (e.g. `src/server.ts:50`)
   - Jira / Confluence / GitHub smart-link rendering explicitly **out of scope** for v1.

2. **Metadata fetching model:** server-side proxy. Frontend calls `GET /link-preview?url=...`; backend does the fetch + OG extraction. Avoids CORS, keeps the frontend thin, makes caching a backend concern.

3. **Rendering location:** frontend-only, runtime. URLs extracted from rendered message text; cards rendered below the bubble. No backend changes to chat pipeline; metadata is not persisted with messages.

4. **URL preview card style:** rich card (Slack/Discord-style) — title, description, thumbnail, favicon, domain. Rendered as a clickable card below the bubble (Atlassian-style attachment).

## File-reference decisions (from brainstorming)

- **Detection scope:** all four forms — absolute paths, relative paths from cwd, relative paths from workspace root, and `path:line` or `path:line-line` line refs.
- **Display style (a):** compact — filename + line number inline (no surrounding code preview).
- **No editor deep-linking** — cards are just inline display, not `vscode://`-style open-in-editor hooks.

## Open questions (unresolved before interruption)

- **URL preview cache strategy:** in-memory only, in-memory + on-disk JSON, or no cache. Recommendation was in-memory keyed by URL with TTL, upgradeable later.
- **File-reference cwd resolution:** whether to scope file-path lookup to the message's session cwd, the active workspace cwd, or fall back through both. Recommendation was "both with fallback."

## Status

- No design doc written (`docs/superpowers/specs/`).
- No implementation plan (`docs/superpowers/plans/`).
- No code changes.
- Brainstorm skill left loaded; can resume by re-running it and answering the two open questions above before proceeding to design.

## Files referenced

- `frontend/src/components/Message.tsx`
- `frontend/src/components/Transcript.tsx`
- `frontend/src/components/Timeline.tsx`
- `frontend/src/markdown.tsx`
- `frontend/src/api/types.ts`
- root `package.json`

## Next steps

1. Resume brainstorming: answer the cache + file-ref cwd questions above.
2. Move to design-present step (3 approaches with trade-offs → recommended design).
3. Write spec to `docs/superpowers/specs/2026-07-14-smart-link-rendering-design.md`.
4. Then invoke `writing-plans`.
