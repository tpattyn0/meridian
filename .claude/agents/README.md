# Role subagents (`.claude/agents/`)

These make role separation **mechanical** instead of trusted. Each role is a
Claude Code subagent with a restricted toolset, so a role cannot do work outside
its remit even if instructed to. This replaces the "start a fresh session in the
right role" discipline with tool-level enforcement (assessment P0-1.2 / SK-3).

| Subagent | Model | Edit/Write tools? | Notes |
|---|---|---|---|
| `reviewer` | Opus | Yes (`reviews/`, `STATUS.md`, index files only — by instruction) | Audits branch HEAD only. Never application code. |
| `planner` | Opus | Yes (docs/plans only, by instruction) | Writes plans and docs; reads plan-as-spec boundary preserved. |
| `coding-agent` | Sonnet | Yes | Full access; branch -> Verify -> PR. Never merges. |
| `gtm` | Opus | Yes (GTM.md + copy, by instruction) | `GTM.md` + standalone copy. Holds `Agent` so it can spawn `project-bootstrap` on a new project. |
| `designer` | Sonnet | Yes (DESIGN.md + specs, by instruction) | `DESIGN.md` + UI specs. |
| `project-bootstrap` | Sonnet | Yes (framework files only, by instruction) | Mechanical Step 1 setup: mkdir, `git init`, `apply-framework.sh`, verify, report human-only steps. No product decisions, no docs, no GitHub repo. |

**The key boundary** is on `reviewer`: it must never touch application code. That
boundary is enforced **by instruction, not by tools.** The reviewer holds
`Write`/`Edit` because the review file is its deliverable — it writes, commits,
and pushes `reviews/YYYY-MM-DD-subject.md` itself, and no other role does that for
it. Its instructions scope those tools to `reviews/`, `STATUS.md`, and index files.

Be honest about what this buys: no subagent in this set is sandboxed away from the
code. The reviewer could edit a source file if it ignored its instructions, and it
keeps `Bash` (needed for the `## Verify` block and git) which can write files
regardless. Role separation here rests on instruction-following plus the session
boundary — same as `planner`, `gtm`, and `designer`, which all keep Write/Edit and
enforce "no code" the same way. For a hard guarantee, gate writes with a PreToolUse
hook matching on path; that is not yet built.

> Earlier versions of this framework gave `reviewer` no `Edit`/`Write` at all.
> That was reverted (commit `f3ce6f8`) because a reviewer that cannot write cannot
> produce its own review file — the restriction traded the deliverable for a
> guarantee it did not actually deliver.

## Install

Copy this `.claude/` directory into your project root alongside `CLAUDE.md`. The
`orchestrate` skill spawns these subagents by name; you can also invoke a role
directly. Each subagent still reads the project's `CLAUDE.md` as the source of
truth for behaviour — the frontmatter only sets tools and model.

## Models

Frontmatter `model:` uses capability tiers, not fixed product names: most-capable
for Planner/Reviewer/GTM (long-tail decision cost), fast for Coding agent/Designer
(scoped execution). Swap the concrete model as the lineup changes.

**Skills access (2026-07-11):** every role subagent now carries the `Skill`
tool, and each agent file names the skills its role should reach for (Reviewer →
`security-review`/`code-review`, Designer → `impeccable`, Planner →
`engineering:architecture`, GTM → marketing skills, Coding agent → Context7
MCP + Playwright). Skills supplement CLAUDE.md's role instructions — output
formats, guardrails, and lifecycle rules always win. The `mcp__context7` grant
on `coding-agent` expects a user-scoped MCP server named `context7` on the
machine — HUMAN_GUIDE.md §12 (new machine setup) has the one-line register
command; the grant is inert until that's done.
