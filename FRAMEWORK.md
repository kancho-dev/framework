# Framework Instructions

Read this file at the start of every framework-managed session.

Operate from the workspace root. Assume the framework lives under `framework/` in that root.

## Purpose

Use this framework to keep software development work coherent across main sessions, coding sessions, delegated work, recurring work, and context loss.

## Core Rules

1. Write important state into files. Do not rely on chat history alone.
2. Keep project code and project knowledge together.
3. Treat handoff files as working memory for task-level execution.
4. Prefer the smallest structure that stays consistent.
5. Load only the context, role files, skills, and references needed for the run.
6. Use searchable memory only as support, not as the source of truth for current state or policy.

## Runtime Model

```text
Run = Base + Role + Skills + Context
```

- **Base** = this file, `framework/SECURITY.md`, and the active workspace instructions/state.
- **Role** = the primary mindset and scope for the run.
- **Skills** = optional procedural playbooks loaded only when relevant.
- **Context** = the smallest set of workspace, project, task, and reference files needed.

## Read Order

### Main session

1. `framework/FRAMEWORK.md`
2. `framework/SECURITY.md`
3. `framework/ROLES/OVERSEER.md`
4. `ACTIVE-CONTEXT.md`
5. today's `memory/daily-brief-YYYY-MM-DD.md` if it exists; otherwise the latest daily brief under `memory/` if any exist
6. relevant project `library/` files when making project decisions
7. selected reference docs only when needed:
   - `framework/WORKSPACE.md` for workspace/project layout and state files
   - `framework/TASKS.md` for task structure, review loops, and task closure
   - `framework/SKILLS.md` for skill resolution rules
8. selected skills only when relevant
9. optional memory retrieval only when markdown files leave a specific context gap

### Task session

1. `framework/FRAMEWORK.md`
2. `framework/SECURITY.md`
3. the role file for the run under `framework/ROLES/`
4. task files under `projects/[name]/work/[task-slug]/`
5. relevant project `library/` files
6. selected reference docs, skills, and optional memory only when needed

### Implementation work

Before code or documentation implementation changes, also read:

- `framework/ENGINEERING.md`

## Roles

Use one primary role per run.

Default roles:

- `framework/ROLES/OVERSEER.md` — top-level orchestration, planning, and review.
- `framework/ROLES/BUILDER.md` — implementation work.
- `framework/ROLES/ORACLE.md` — review and verification.
- `framework/ROLES/HISTORIAN.md` — documentation and state hygiene.

The default top-level session role is Overseer.

## Skills

Skills are optional playbooks under `framework/SKILLS/` or local project/workspace skill directories.

Do not read every skill by default. Use indexes only to choose relevant skills, then load the selected `SKILL.md`.

Check relevant skill indexes before improvising when the prompt names a skill-like workflow, asks to "check skills", or describes a repeatable framework procedure such as next-best-actions, task pickup, task closure, review/testing, docs sync, workspace maintenance, framework update, memory search, or creating local skills.

Check indexes in local-capability precedence order when they exist:

1. project-local index: `projects/[name]/SKILLS/INDEX.md`
2. workspace-custom index: `SKILLS/INDEX.md`
3. framework index: `framework/SKILLS/INDEX.md`

If the correct skill or scope remains unclear, ask the Operator before executing the skill. See `framework/SKILLS.md` for details.

## Task And Workspace References

This core file intentionally stays short. Load details only when needed:

- `framework/WORKSPACE.md` — workspace files, project structure, repository boundaries, what-goes-where.
- `framework/TASKS.md` — micro/minimal/full tasks, task files, task patterns, separate Builder–Oracle runs, review result shape.
- `framework/SKILLS.md` — skill locations, routing indexes, precedence, collisions, optional resources/scripts.

## Escalation Flow

Use the smallest sensible escalation path when uncertainty blocks progress.

Default ladder:

```text
Builder / Oracle / Historian
        ↓
     Overseer
        ↓
     Operator
```

Rules:

- do not guess when a missing decision could change scope, correctness, or risk;
- prefer a concise explicit question over silent assumption-making;
- record persistent blockers or decisions in workspace/task state.

## End Of Session

Before ending meaningful work:

1. update the relevant handoff, context, or active state files;
2. append to today's daily brief using the real current system date/time;
3. record durable fixes in `FIXES.md` when relevant;
4. move lasting project knowledge into `projects/[name]/library/` when relevant.

## Tool Agnosticism

Do not assume a specific chat platform, transcript format, cron system, model vendor, or web UI. Treat those as adapters outside the framework core.
