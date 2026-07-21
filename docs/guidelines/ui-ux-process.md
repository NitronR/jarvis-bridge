# UI/UX Redesign Process

Reference guide for how a senior UI/UX designer approaches redesigning an existing
product. Use this to structure any redesign work on jarvis_bridge's frontend
(`ChatPanel`, `Composer`, `Sidenav`, terminal drawer).

## Stages

### 1. Discovery & Goal Alignment

Define why the redesign is happening — not just "make it prettier." Without this,
every later stage lacks a yardstick to judge decisions against.

- Clarify business goals, user pain points, and constraints (timeline, tech stack,
  team size) with stakeholders before any screen is touched.
- Set measurable success metrics up front — task completion time, error rate,
  support tickets, retention — so "did the redesign work?" has a real answer later,
  not just a subjective "it looks nicer."
- Scope the effort honestly: a single feature redesign is a 2-4 week effort; a
  full product redesign spans 3-6 months. Naming which one you're doing prevents
  scope creep mid-project.
- Output: a one-page brief — problem statement, goals, non-goals, success metrics,
  rough timeline.

### 2. UX Audit of the Current Product

The existing UI is the best available prototype — it already encodes years of
real usage and edge cases. Skipping this and redesigning from a blank canvas
throws that knowledge away.

- **Heuristic evaluation**: review every core screen/flow against Nielsen's 10
  usability heuristics — visibility of system status, match between system and
  the real world, user control and freedom, consistency and standards, error
  prevention, recognition rather than recall, flexibility and efficiency of use,
  aesthetic and minimalist design, help users recognize/diagnose/recover from
  errors, and help/documentation.
- Nielsen's own research found a single evaluator catches only ~35% of usability
  problems; 3-5 independent evaluators (each reviewing separately, without
  discussing findings beforehand, then pooling results) is the sweet spot for
  catching most severe issues without diminishing returns.
- Run a **consistency check** (do buttons/labels/spacing mean the same thing
  everywhere?) and an **accessibility pass** (contrast ratios, keyboard nav,
  screen-reader labels, focus states).
- Walk every core user flow end-to-end and catalog friction points — dead ends,
  unclear states, places users have to guess.
- Output: a severity-ranked list of usability issues (critical / major / minor),
  each tied to a specific screen or flow, not vague impressions.

### 3. User Research

Generative research (talk to users about needs) is different from evaluative
research (watch users struggle with what exists) — a redesign needs both, and
conflating them produces a design that solves problems users don't actually have.

- **User interviews** (qualitative, generative): open-ended conversations to
  surface the *reasoning* behind behavior — motivations, mental models, emotional
  reactions analytics can't show. Best run early, during discovery.
- **Usability testing on the current UI** (qualitative, evaluative): watch real
  users attempt real tasks in the existing product. This is the single highest-
  leverage research activity for a redesign — it turns "looks dated" into
  "actually breaks the experience" or reveals the opposite (a screen that looks
  ugly but users navigate fine — leave it alone).
- Choose method by constraint: moderated lab sessions for depth, guerrilla
  testing for speed/low cost, remote unmoderated tests when users are distributed.
- Session recordings and product analytics (funnel drop-off, rage clicks, dead
  clicks) supplement interviews with quantitative signal at scale.
- Output: a synthesized findings doc — recurring themes, direct quotes, and
  which heuristic-audit issues are corroborated (or contradicted) by real users.

### 4. Competitive & Pattern Analysis

Users bring expectations from every other product they use — a redesign that
ignores established conventions creates unnecessary relearning cost.

- Set a specific objective first ("identify the fastest onboarding flow among
  comparable tools" beats "understand the landscape").
- Scope 3-5 direct competitors, 1-2 indirect ones (different approach, same
  problem), plus one aspirational/best-in-class example outside the category.
- Define evaluation criteria up front: navigation depth, onboarding friction,
  accessibility, microcopy tone, visual density, mobile parity.
- Score each competitor against the criteria (a simple traffic-light/heat-map
  table works) rather than collecting screenshots with no structure.
- Output: a comparison table plus a short "gaps and opportunities" summary —
  what's table-stakes to match vs. what's a genuine differentiator to own.

### 5. Information Architecture

IA is the structural skeleton — navigation, hierarchy, labeling — and it's
independent of visual design. Fixing structure here is what prevents "new colors,
same confusion" after launch.

- **Open card sorting** (participants group content into their own categories)
  when structure is still flexible and you need to discover how users mentally
  group things.
- **Closed or hybrid card sorting** when some categories are fixed and you're
  refining rather than discovering from scratch.
- **Tree testing** once you have a draft sitemap/labels — text-only navigation
  with no visual design, used to validate that people can actually find things
  in the proposed structure before it's built.
- Card sorting generates IA options; tree testing evaluates them. Doing only one
  of the two either skips discovery or skips validation.
- Deliverables: sitemap, task/user flows, and a navigation label list — all
  reviewable without a single visual mock.

### 6. Design System & Visual Language

This is the "elegant and beautiful" layer users actually notice — but it only
produces a coherent result when built on stages 2-5, as reusable decisions
rather than per-screen choices.

- Structure tokens in layers: **primitive** (raw values, e.g. `blue-500`),
  **semantic** (usage-specific, e.g. `color-action-primary`), and **component**
  (per-component overrides, e.g. `button-primary-bg`). This separation is what
  lets a future theme or dark-mode change happen in one place instead of a
  find-and-replace across every screen.
- Typography tokens are usually composite — font family, size, weight, line
  height, and letter spacing bundled into one named style (e.g. `heading-lg`)
  rather than set independently each time.
- Only tokenize patterns that actually repeat — auditing existing screens for
  the colors/spacing/type styles already in use (and consolidating near-duplicates)
  is more valuable than inventing a token system from scratch.
- Tokens are platform-agnostic by design — the same token set can emit CSS
  variables, and this repo's frontend is plain CSS Modules (`*.module.css`), so
  tokens land naturally as CSS custom properties.
- Output: a token set (color, type, spacing, elevation, motion) plus a small
  component library (buttons, inputs, cards, states) built from those tokens.

### 7. Wireframes → Prototypes

Fidelity level should match the decision being made — jumping straight to
polished mockups risks polishing a structure nobody's validated yet.

- **Low-fidelity** (sketches/grayscale wireframes): fast and cheap to change,
  used to validate layout and flow *before* investing in visual detail. Ideal
  for brainstorming and early stakeholder alignment.
- **High-fidelity** (interactive, real tokens/components applied): used once
  the low-fi structure is validated — tests real visual hierarchy, animations,
  error/loading/edge-case states, and doubles as a living spec for developers.
- The common failure mode this guards against: getting stakeholder sign-off on
  a beautiful high-fidelity mock whose underlying flow was never tested, then
  discovering the structural problem after build has started.
- Output: reviewed low-fi flows, followed by a clickable high-fidelity prototype
  covering primary and key edge-case states.

### 8. Usability Testing & Iteration

- Test the high-fidelity prototype with real users on the actual tasks defined
  in stage 1's goals — not "does it look nice" but "can they complete the task."
- Each stage in this process has a defined input, output, and review gate — the
  next stage shouldn't start until the current one's output is reviewed and
  approved. Skipping gates is how structural problems (from stage 5) resurface
  as visual rework later (in stage 6-7), which is far more expensive to fix.
- Iterate on findings; re-test if changes are structural, ship if they're minor
  polish.

### 9. Developer Handoff

Historically the most error-prone stage — fidelity gets lost when developers
interpret static mockups without specs, so treat handoff as translation, not
just a file dump.

- Label layers/components clearly and use variants for interactive states
  (hover, active, disabled, loading) rather than separate flat mockups per state.
- Export design tokens in dev-consumable format (CSS custom properties for this
  frontend) instead of hand-copied hex values, so tokens and code can't drift.
- Annotate designs with the "why" behind non-obvious decisions — spacing
  exceptions, responsive behavior, animation timing — the same standard this
  repo already holds code comments to.
- Output: a component-by-component spec developers can implement from without
  needing to guess or re-ask the designer for every state.

## Applying this to jarvis_bridge

The frontend surface area is fairly contained (chat + tool calls + terminal
drawer), so stages 2-4 collapse into something lightweight compared to a
multi-team SaaS product. The most common failure mode is skipping straight to
stage 6 (visual polish) without stage 2 (audit) and stage 5 (IA) — this produces
a UI that's prettier but still structurally confusing.

Concretely, for this codebase:
- Stage 2 (audit) maps to a heuristic pass over `ChatPanel`, `Composer`, `Sidenav`,
  and the terminal drawer.
- Stage 6 (tokens) maps naturally onto the existing `*.module.css` files —
  introducing CSS custom properties for color/spacing/type rather than hardcoded
  values scattered per component.
- Stage 9 (handoff) is less relevant when the same person designs and implements,
  but the "annotate the why" habit is still worth keeping for non-obvious CSS
  decisions.

Per project workflow: actual redesign work should go through the
`superpowers:brainstorming` skill first to nail down scope/intent, and any
resulting design spec should go through `plannotator annotate` for review before
being finalized.

## Sources

- [UX Design Process | UXtweak](https://www.uxtweak.com/ux-design/process/)
- [How to Execute a UX Redesign in 7 Steps | Userpilot](https://userpilot.com/blog/ux-redesign/)
- [UX Design Process: The Complete 7-Step Guide for 2026 | UXPin](https://www.uxpin.com/studio/blog/design-process-ux/)
- [How To Conduct A UX Redesign | CareerFoundry](https://careerfoundry.com/en/blog/ux-design/how-to-conduct-a-ux-redesign/)
- [How to Conduct A UX Redesign? | UX Design World](https://uxdworld.com/2021/03/22/how-to-conduct-ux-redesign/)
- [How To Conduct A UX Audit | Sevenpeaks](https://sevenpeakssoftware.com/blog/ux-audit-why-how/)
- [12 Steps of a UX Audit and Redesign | Specno](https://www.specno.com/blog/ux-audit-redesign)
- [What is the typical process for a UI/UX design project? | Phenomenon](https://phenomenonstudio.com/article-faq/what-is-the-typical-process-for-a-ui-ux-design-project/)
- [The Ultimate UX Audit Checklist: A Heuristic Evaluation Guide | SiteCrafting](https://www.sitecrafting.com/articles/ux-audit-checklist/)
- [How to Conduct a Heuristic Evaluation: Your Free Checklist | Maze](https://maze.co/guides/usability-testing/heuristic-evaluation/)
- [Nielsen's 10 Usability Heuristics | Heurio](https://www.heurio.co/nielsens-10-usability-heuristics)
- [11 UX Research Methods and When to Use Them | Maze](https://maze.co/guides/ux-research/methods/)
- [When to Use Which User-Experience Research Methods | NN/G](https://www.nngroup.com/articles/which-ux-research-methods/)
- [7 Essential usability testing methods for UX insights | Maze](https://maze.co/guides/usability-testing/methods/)
- [Card Sorting vs. Tree Testing | NN/G](https://www.nngroup.com/articles/card-sorting-tree-testing-differences/)
- [Tree Testing vs. Card Sorting: Which is Right for You? | Maze](https://maze.co/guides/tree-testing/vs-card-sorting/)
- [Design Tokens in 2026: Beyond Colors and Spacing | Design Systems Collective](https://www.designsystemscollective.com/design-tokens-in-2026-beyond-colors-and-spacing-d2fd632029e1?gi=58aa4bcf0b52)
- [Design tokens explained | Contentful](https://www.contentful.com/blog/design-token-system/)
- [Design Systems 101: Tokens, Components, and Documentation | NamasteDev](https://namastedev.com/blog/design-systems-101-tokens-components-and-documentation/)
- [Conducting UX Competitive Analysis: How To + Free Template | Maze](https://maze.co/collections/ux-ui-design/ux-competitive-analysis/)
- [UX Competitive Analysis: 6 Research Methods & Complete Guide | UXPin](https://www.uxpin.com/studio/blog/competitive-analysis-for-ux/)
- [The Step-by-Step Guide to UX Competitive Analysis | Baymard](https://baymard.com/learn/competitive-analysis-ux)
- [Low-Fidelity vs. High-Fidelity Wireframes: When & How to Use Each | Magic Patterns](https://www.magicpatterns.com/blog/low-fidelity-vs-high-fidelity-wireframes)
- [High-Fidelity vs. Low-Fidelity Prototyping: When to Use Each | UXPin](https://www.uxpin.com/studio/blog/high-fidelity-prototyping-low-fidelity-difference/)
- [Guide to developer handoff in Figma](https://www.figma.com/best-practices/guide-to-developer-handoff/)
- [Tips on developer handoff in Figma](https://www.figma.com/best-practices/tips-on-developer-handoff/)
- [Design Handoff 2.0: Beyond Redlines and Specs | Medium](https://robertcelt95.medium.com/design-handoff-2-0-beyond-redlines-and-specs-6f0d25f98a7e)
