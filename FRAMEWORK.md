# Framework Instructions

Read this file at the start of every framework-managed session.

Operate from the workspace root. Assume the framework lives under `framework/` in that root.

## Purpose

Use this framework to keep software development work coherent across main sessions, coding sessions, delegated work, recurring work, and context loss.

## Core Rules

1. Write important state into files. Do not rely on chat history alone
2. Keep project code and project knowledge together
3. Treat handoff files as working memory for task-level execution
4. Prefer the smallest structure that stays consistent
5. Load only the context, role files, skills, and references needed for the run
6. Use historical retrieval only as support, not as the source of truth for current state or policy

## Runtime Model

```text
Run = Base + Role + Skills + Context
```

- **Base** = this file, `framework/SECURITY.md`, and the active workspace instructions/state
- **Role** = the primary mindset and scope for the run
- **Skills** = optional procedural playbooks loaded only when relevant
- **Context** = the smallest set of workspace, project, task, and reference files needed

## Read Order

Start every framework-managed session with this common sequence:

1. read `framework/FRAMEWORK.md`
2. read `framework/SECURITY.md`
3. using the rules below select exactly one primary role before reading any file under `framework/ROLES/` where the role files live: `OVERSEER.md`, `BUILDER.md`, `ORACLE.md`, and `HISTORIAN.md`:

   1. the role explicitly named by the Operator or invoking workflow; a named skill is not a role
   2. otherwise the role fitting the next concrete action this run will take:
      - produce or change an artifact — Builder
      - verify existing work against a contract or expectation — Oracle
      - reconcile state, docs, or knowledge with reality — Historian
      - decide, route, prioritize, or stop for a missing decision — Overseer
      - on a Task-session branch, read the referenced task's `HANDOFF.md` when the best fit is not yet clear
   3. otherwise Overseer

4. read only the selected role file

If explicit or applicable guidance names multiple roles without choosing one, resolve the ambiguity with the Operator before loading role guidance. Read a different role file later only for an explicit, justified role transition, and record that transition in task or workspace state when the run is meaningful.

Then continue with the applicable branch.

### Main-session branch

1. Read `ACTIVE-CONTEXT.md`
2. Read today's `memory/daily-brief-YYYY-MM-DD.md` if it exists; otherwise read the latest daily brief under `memory/`, if any
   - If today's brief does not exist and you later create it, start with a short `Carry-forward from previous brief` section containing only important unfinished actionable items from the latest previous brief
   - Mark a carry-forward item checked in today's brief when confirmed complete; do not rewrite older briefs
3. Read relevant project `library/` files when making project decisions
4. Load reference docs only when a specific open question requires them, not to prepare:
   - `framework/WORKSPACE.md` — placing state, or project/repository layout
   - `framework/TASKS.md` — a task-contract question the task files and applicable skill leave unresolved
   - `framework/SKILLS.md` — skill precedence or a collision
5. Load selected skills only when relevant

### Task-session branch

1. Read task files under `projects/[name]/work/[task-slug]/`
   - Check task-local `NOTES.md` exactly once when task work starts
   - If it contains non-whitespace Steering Notes, read and capture the payload successfully, immediately delete `NOTES.md`, and act on it once
   - Do not poll during the run; notes saved afterward belong to the following Task Run
2. Read relevant project `library/` files
3. Load reference docs and skills only when needed, using the same triggers as the main-session branch

### Implementation work

Before code or documentation implementation changes, also read:

- `framework/ENGINEERING.md`

## Skills

Skills are optional playbooks under `framework/SKILLS/` or local project/workspace skill directories.

Do not read every skill by default. Use indexes only to choose relevant skills, then load the selected `SKILL.md`.

Check relevant skill indexes before improvising when the prompt names a skill-like workflow, asks to "check skills", or describes a repeatable framework procedure such as next-best-actions, task pickup, task closure, review/testing, docs sync, workspace maintenance, framework update, or creating local skills.

Check indexes in local-capability precedence order when they exist:

1. project-local index: `projects/[name]/SKILLS/INDEX.md`
2. workspace-custom index: `SKILLS/INDEX.md`
3. framework index: `framework/SKILLS/INDEX.md`

If the correct skill or scope remains unclear, ask the Operator before executing the skill. See `framework/SKILLS.md` for details.

## Task And Workspace References

This core file intentionally stays short. Load details only when needed:

- `framework/WORKSPACE.md` — workspace files, project structure, repository boundaries, what-goes-where
- `framework/TASKS.md` — micro and tracked tasks, task files, task patterns, separate Builder–Oracle runs, review result shape
- `framework/SKILLS.md` — skill locations, routing indexes, precedence, collisions, optional resources/scripts

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

- do not guess when a missing decision could change scope, correctness, or risk
- prefer a concise explicit question over silent assumption-making
- record persistent blockers or decisions in workspace/task state

## End Of Session

Before ending meaningful work:

1. update the relevant handoff, context, or active state files
2. append a timed entry to the end of today's daily brief using the real current system date/time; before creating or writing a daily brief, check whether the dated file exists and never overwrite an existing daily brief
3. record durable fixes in `FIXES.md` when relevant
4. move lasting project knowledge into `projects/[name]/library/` when relevant

## Tool Agnosticism

Do not assume a specific chat platform, transcript format, cron system, model vendor, or web UI. Treat those as adapters outside the framework core.
