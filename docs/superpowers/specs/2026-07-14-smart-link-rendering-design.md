# Smart-link rendering in chat messages — design

**Date:** 2026-07-14
**Status:** Approved (pending spec review)

## Problem

Chat messages render through `react-markdown` (`frontend/src/markdown.tsx`)
for assistant text, and as raw `<div>{entry.text}</div>` for user text
(`Message.tsx`). URLs in assistant messages become clickable via GFM
autolinking but carry no metadata; URLs in user messages aren't even
clickable. File/line references the agent mentions (`src/server.ts:50`)
render as inert text in both cases. There's no Confluence/Jira-style
"paste a link, get a rich preview" experience anywhere in the app.

We want two independent enrichments, both additive to existing rendering:

1. **URL preview cards** — Slack/Discord-style cards (title, description,
   thumbnail, favicon, domain) rendered below the message bubble for any
   URL found in the message text.
2. **File-reference chips** — compact inline `filename:line` pills for
   file paths and line refs found in the message text, only when the
   referenced file actually exists.

Jira/Confluence/GitHub-specific smart-link rendering (e.g. unfurling a
Jira ticket into its title/status) is explicitly **out of scope** for v1.

## Constraints

- No persistence. Enrichment data is not stored with the message or in
  session history — it's re-derived at render time on every view, from
  message text that's already there.
- No changes to the chat pipeline (`ChatPatch`, `session/load` replay,
  streaming). This is a pure rendering-layer addition downstream of
  existing message text.
- Backend fetches URLs on the user's behalf, which is an SSRF surface
  the gateway didn't have before (per `AGENTS.md`, new external-integration
  surfaces need care). Must not allow it to reach internal/private
  network targets.
- File-reference resolution must not become a filesystem-existence
  oracle for arbitrary host paths. It must reuse the same containment
  discipline as `src/tools/pathGuard.ts` (workspace/session-cwd only,
  symlink-resolved), not a parallel path-safety implementation.
- Minimal new dependencies — this repo has no HTML-parsing library
  today; OG-tag extraction should stay a narrow hand-rolled scan of
  `<head>`, not a general-purpose HTML parser pulled in for one feature.

## Approach

Two new read-only, unauthenticated GET endpoints added to `src/server.ts`
(following the existing pattern — all routes live in that one file;
business logic factored into new modules and imported in, the way
`sessionConfigStore` is), plus frontend-only detection and rendering.
Nothing is pushed onto the backend proactively; both endpoints are
called on-demand by the frontend as it renders message text it already
has.

### Why frontend-driven detection (not backend-side, not persisted)

Considered doing detection/enrichment server-side at message-send time
and persisting the result in `ChatPatch`. Rejected: it would couple an
optional, best-effort cosmetic feature to the chat pipeline's
correctness-critical `session/load` replay path (explicitly a
don't-touch zone per `AGENTS.md`), and it would mean re-fetching/storing
preview data for messages that may never be scrolled into view.
Frontend-driven, on-demand, unpersisted enrichment keeps this feature
fully separable from the pipeline — it can be deleted or disabled
without touching a single line of session/replay code.

## URL preview cards

### Backend: `GET /link-preview?url=<encoded>`

New module `src/linkPreview/` (`fetch.ts`, `cache.ts`), wired into
`src/server.ts` as a new route alongside the existing ones.

- **Validation**: reject anything that isn't `http:`/`https:`. Resolve
  the hostname and reject loopback, private (`10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`), and link-local ranges before
  fetching — this is the SSRF guard. Return `400` with no fetch attempt.
- **Fetch**: `~5s` timeout; stop reading the response once `</head>` is
  seen or a `100KB` cap is hit, whichever comes first, so a huge or
  slow-drip response can't tie up the request.
- **Extraction**: a small regex/streaming scan of the `<head>` for
  `og:title`, `og:description`, `og:image`, `og:site_name`, and a
  favicon `<link>` — not a general HTML parser. Falls back to `<title>`
  if no `og:title` is present.
- **Cache**: in-memory `Map<url, {data, expiresAt}>` in `cache.ts`. TTL
  1 hour. Max 500 entries; overflow evicts the oldest-inserted entry
  (simple insertion-order eviction, not a full LRU — good enough for a
  process-lifetime cache of a cosmetic feature).
- **Response**: `200` with `{ url, title?, description?, image?,
  siteName?, favicon? }` on success. On fetch/parse failure (timeout,
  non-2xx, non-HTML content-type, no OG tags found), still `200` with
  `{ url, title: null }` — a "no preview available" result, distinct
  from the `400` SSRF-reject case. The frontend treats both non-title
  cases identically (render nothing extra), but keeping them
  distinguishable in the response aids debugging via the existing
  per-session API logs.

### Frontend: `LinkPreviewCard`

- New `frontend/src/components/LinkPreviewCard.tsx` (+ `.module.css`).
- New parsing helper (in a new `frontend/src/smartLinks.ts`) that
  extracts URLs from a message's rendered text — reusing the same URL
  regex GFM autolinking already effectively uses, not reimplementing
  URL detection from scratch.
- Rendered **below the message bubble** in `Message.tsx`, one card per
  unique URL found, stacked if more than one. Applies to both assistant
  and user messages — this is also what makes user-message URLs
  clickable at all (today they're inert text).
- On mount, `fetch(`/link-preview?url=...`)`; shows a lightweight
  skeleton while pending. If the response has no `title`, or the fetch
  itself fails/errors, the card renders nothing (the underlying text
  stays exactly as it renders today — plain autolinked text for
  assistant messages, plain text for user messages that also get a
  bare clickable link from this same pass).

## File-reference chips

### Backend: `GET /file-ref/resolve?path=<raw>&sessionId=<id>`

New module `src/fileRef/resolve.ts`, wired into `src/server.ts`.

- **Root lookup**: `registry.findSession(sessionId)` gives the entry's
  `cwd` (session root). Workspace root is the existing `workspace`
  value already threaded into `createServer`. Try session cwd first,
  then workspace root — per the resolved fallback design.
- **Containment**: reuse `pathGuard.ts`'s `realpathExistingOrSymlink`
  and `assertInWorkspace` helpers (parameterized by whichever root is
  being tried) rather than writing new path-safety logic. A path that
  doesn't resolve within *either* root (after symlink resolution) is
  treated as unresolved — no existence information about it is
  returned.
- **Line-ref parsing**: strip a trailing `:N` or `:N-M` suffix before
  the fs check; reattach it in the response.
- **Response**: `{ exists: true, resolvedRoot: "session" | "workspace",
  displayPath, line? }` or `{ exists: false }`. `displayPath` is the
  path as matched in the message text (or workspace-relative), never an
  absolute host path — so a resolved response can't leak filesystem
  layout beyond what the user already typed.
- **No file contents are read** — existence/shape only. Reading content
  is what the existing sandboxed `readFile` tool is for.

### Frontend: `FileRefChip`

- New `frontend/src/components/FileRefChip.tsx` (+ `.module.css`).
- Same `smartLinks.ts` helper adds file-reference detection: four
  regex forms — absolute path, relative-to-session-cwd, relative-to-
  workspace-root, and any of those with a trailing `:N`/`:N-M`.
- Rendered **inline**, replacing the plain-text occurrence, as a
  compact `filename:line` pill — not a card, no code preview, no
  editor deep-link (per the earlier resolved decisions).
- On mount, `fetch(`/file-ref/resolve?...`)`. While pending, renders as
  plain text (no flash of a chip that might not resolve). If
  `exists: false` or the fetch fails, stays plain text permanently for
  that render — including likely false positives like `10:30` in prose,
  which will simply fail the existence check and never call attention
  to themselves.

## Data flow (end to end)

1. Message renders (assistant via markdown, user via plain text) as it
   does today.
2. `smartLinks.ts` scans the rendered text and returns `{ urls: string[],
   fileRefs: {raw, path, line?}[] }`.
3. For each URL, `LinkPreviewCard` mounts below the bubble and fetches
   `/link-preview`.
4. For each file-ref, `FileRefChip` mounts inline (swapped in for the
   plain-text span) and fetches `/file-ref/resolve` with the message's
   `sessionId`.
5. Both fetches hit the backend's in-memory caches/containment checks
   independently; nothing is written back to chat state, session
   history, or `ChatPatch`.

## Error handling & edge cases

| Case | Behavior |
|---|---|
| URL fetch times out / non-HTML / no OG tags | `200` `{title: null}` → card renders nothing |
| URL targets private/loopback IP or non-http(s) scheme | `400` → card renders nothing |
| File-ref resolves outside both roots (incl. symlink escape) | `{exists: false}` → stays plain text |
| File-ref false positive (`10:30` in prose) | Fails existence check → stays plain text, no visible artifact |
| Same URL/path repeated across messages | Backend cache (URL) / cheap fs stat (file-ref) absorb repeats |
| Rapid re-render of the same message | Per-component `fetch` keyed on the URL/path; browser + backend caching absorb duplicates |

## Testing

- **Backend** (`node:test`): `/link-preview` — OG extraction from fixture
  HTML, SSRF rejection (private IP, non-http scheme), 100KB/timeout cap
  behavior, cache hit/miss/eviction. `/file-ref/resolve` — session-cwd
  hit, workspace-fallback hit, outside-both-roots rejection, symlink-
  escape rejection (mirroring existing `pathGuard` test cases), line-ref
  parsing (`:N` and `:N-M`).
- **Frontend** (Vitest + Testing Library): `smartLinks.ts` — URL
  extraction, all 4 file-ref forms, false-positive shapes.
  `LinkPreviewCard`/`FileRefChip` — loading → resolved → fallback states
  with mocked `fetch`.

## Out of scope

- Jira/Confluence/GitHub-specific unfurling.
- Editor deep-linking (`vscode://`) from file-ref chips.
- Persisting preview/resolution data with messages or session history.
- On-disk cache persistence across gateway restarts.
- Code preview snippets in file-ref chips (filename:line text only).
- A dedicated cache-purge endpoint (TTL-only invalidation).

## Open questions

None at design time.
