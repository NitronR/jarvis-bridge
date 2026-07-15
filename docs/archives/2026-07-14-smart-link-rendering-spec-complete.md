# Smart-link rendering — brainstorm resumed, spec written, plan not started

**Date:** 2026-07-14
**Session ID:** ed0a1e22-763f-49b9-86ac-9bf55a6114c4

## Summary

Continuation of the interrupted brainstorm from earlier the same day
(see `docs/archives/2026-07-14-smart-link-rendering-brainstorm.md`,
left as-is per the don't-edit-archives convention). This session:

1. Resumed the `superpowers:brainstorming` skill and resolved the two
   open questions left from the prior session.
2. Presented the full design section by section (architecture, backend
   URL-preview endpoint, backend file-ref resolution endpoint, frontend
   rendering, error handling, testing) and got approval on each.
3. Wrote the design spec to
   `docs/superpowers/specs/2026-07-14-smart-link-rendering-design.md`,
   ran the self-review pass (fixed one leftover typo), and got the
   user's approval to proceed.
4. Started the `writing-plans` skill (had to read the SKILL.md directly —
   the `Skill` tool returned "Unknown skill" for both `writing-plans`
   and `superpowers:writing-plans` despite the skill existing on disk
   at `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/writing-plans/`
   and being listed as available; worth a bug report if it recurs).
5. While mapping out the file-reference-chip task, hit a real design
   gap: the spec says file-ref chips render "inline, replacing the
   plain-text occurrence," which is straightforward for user messages
   (plain text today) but requires a custom rehype/remark AST-walking
   plugin for assistant messages (rendered via `react-markdown` in
   `Timeline.tsx`). Surfaced three options to the user (full inline
   substitution everywhere / inline for user text + below-bubble row
   for assistant text / user-messages-only for v1) and was waiting on
   an answer.
6. **User pivoted away from the feature at that point** — asked to
   deprioritize smart-link rendering entirely for now and instead fix
   chat-message link-color readability (see
   `docs/archives/2026-07-14-chat-link-color-fix.md` for that work).

## Key decisions (locked into the spec)

- URL-preview cache: in-memory only, TTL-based (no disk persistence).
- File-ref cwd resolution: try session cwd first, fall back to
  workspace root — never workspace-only or session-only.
- File-ref resolution must reuse `pathGuard.ts`'s containment
  discipline (not reimplement path-safety logic) so it can't become a
  filesystem-existence oracle for arbitrary host paths — this was a
  gap the user hadn't raised and the assistant flagged proactively
  before writing the spec.
- OG-tag extraction: hand-rolled regex scan of `<head>`, not a new
  HTML-parsing dependency (matches the repo's minimal-deps style).
- SSRF guard on `/link-preview`: reject non-http(s) schemes and
  loopback/private/link-local IPs (resolved via DNS) before fetching.

## Status

- Spec: **written, self-reviewed, and approved.** Lives at
  `docs/superpowers/specs/2026-07-14-smart-link-rendering-design.md`.
  Not yet committed to git (commits require explicit user ask, per
  global instructions — skills don't grant commit permission).
- Plan: **not started.** The `writing-plans` skill was invoked (via
  direct SKILL.md read, working around the tool-resolution issue) but
  no plan document was written before the user redirected.
- Implementation: **no code written** for this feature.

## Files referenced (unchanged this session, for context)

- `frontend/src/components/Message.tsx`
- `frontend/src/markdown.tsx`
- `frontend/src/components/Timeline.tsx`
- `src/server.ts` (route-registration pattern, all routes in one file)
- `src/tools/pathGuard.ts` (containment helpers to be reused)
- `src/tools/readFile.ts` / `src/tools/index.ts` (closure-over-realpath pattern)
- `src/agent/backendRegistry.ts` (`RegistrySessionEntry.cwd`, `findSession`)

## Next steps

1. When resumed, first get the user's answer on the file-ref inline-vs-
   below-bubble question for assistant messages (see point 5 above) —
   this determines whether Task N needs a custom rehype plugin or a
   simpler below-the-bubble chip row.
2. Re-invoke `writing-plans` (read the SKILL.md directly if the `Skill`
   tool still can't resolve it) to produce
   `docs/superpowers/plans/2026-07-14-smart-link-rendering.md`.
3. Offer subagent-driven vs. inline execution once the plan is written.
