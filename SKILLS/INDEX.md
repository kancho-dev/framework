# Skills Index

Use this index to choose relevant skills. Do not load every skill by default.

## Skill Format

Each skill lives in a directory named after the skill:

```text
SKILLS/[skill-name]/SKILL.md
```

Each `SKILL.md` may include minimal YAML frontmatter for discovery:

```yaml
---
name: skill-name
description: "One-sentence summary of when this skill helps."
---
```

The frontmatter is optional metadata for humans and agents. The markdown body remains the source of the actual procedure.

## Optional Skill Contents

A skill may add supporting directories when they reduce repeated work or keep the main procedure concise:

```text
SKILLS/[skill-name]/
  SKILL.md        # required: main procedure and loading guidance
  resources/      # optional: reference material loaded only when needed
  scripts/        # optional: reviewed helper scripts for deterministic safe steps
  artifacts/      # optional: reusable examples, templates, or generated outputs
```

Keep simple skills as only `SKILL.md`. Add optional directories only when there is a clear use case.
`SKILL.md` must remain enough to understand and execute the skill without custom tooling.
Review any script before running it and follow `framework/SECURITY.md`.

## Planning / Orchestration

- `next-best-actions` — identify the highest-value next actions from current workspace or project state.
  - Read: `framework/SKILLS/next-best-actions/SKILL.md`

## Task Execution

- `task-pickup` — resume an existing task from task files and choose the next bounded step.
  - Read: `framework/SKILLS/task-pickup/SKILL.md`
- `task-closure` — close or pause a task cleanly with updated task/project/workspace state.
  - Read: `framework/SKILLS/task-closure/SKILL.md`

## Review / Quality

- `review-and-test` — verify work against intended outcomes and acceptance criteria.
  - Read: `framework/SKILLS/review-and-test/SKILL.md`
- `docs-sync` — align documentation with implemented or current behavior.
  - Read: `framework/SKILLS/docs-sync/SKILL.md`

## Maintenance / State Hygiene

- `self-check` — inspect workspace-level coordination state for staleness or drift.
  - Read: `framework/SKILLS/self-check/SKILL.md`
- `project-self-check` — inspect a project's task state, library files, and docs for drift.
  - Read: `framework/SKILLS/project-self-check/SKILL.md`
- `update-framework` — align an already framework-managed workspace with newer framework changes.
  - Read: `framework/SKILLS/update-framework/SKILL.md`

## Optional Memory Retrieval

- `memory-search` — use optional memory retrieval when current markdown files are insufficient.
  - Read: `framework/SKILLS/memory-search/SKILL.md`
