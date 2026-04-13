# Framework Instructions

Read this file at the start of every session.

You are operating from the workspace root.
Assume the framework files live under `framework/` in that root.

## Purpose

Use this framework to keep software development work coherent across:
- main sessions
- coding sessions
- delegated work
- recurring work
- session compaction or context loss

## Operating Rules

1. Write important state into files. Do not rely on chat history alone.
2. Keep project code and project knowledge together.
3. Treat handoff files as working memory for task-level execution.
4. Prefer the smallest structure that stays consistent.
5. Use searchable memory only as a support layer, not as the source of truth for current state.

## Read Order

### Main session

Read in this order:
1. `framework/FRAMEWORK.md`
2. `framework/SECURITY.md`
3. `framework/ENGINEERING.md`
4. `ACTIVE-CONTEXT.md`
5. today's `memory/daily-brief-YYYY-MM-DD.md` if it exists
6. relevant files under `projects/[name]/library/`

### Task session

If you are working on a task under `projects/[name]/work/[task-slug]/`, read in this order:
1. `framework/FRAMEWORK.md`
2. `framework/SECURITY.md`
3. `framework/ENGINEERING.md`
4. `projects/[name]/work/[task-slug]/TASK.md`
5. `projects/[name]/work/[task-slug]/HANDOFF.md`
6. `projects/[name]/work/[task-slug]/CONTEXT.md`
7. relevant files under `projects/[name]/library/`

## Workspace Files

### `ACTIVE-CONTEXT.md`

Use this file as hot memory for the whole workspace.

Update it when:
- priorities change
- work starts or finishes
- blockers appear
- the user changes direction

### `memory/daily-brief-YYYY-MM-DD.md`

Use this file as the shared daily log.

Append a short factual entry after meaningful work.

Format:

```markdown
## HH:MM — [Session Type]
**Did:** [what was accomplished]
**For next:** [what the next session should know]
```

### `FIXES.md`

Use this file for non-obvious bugs, failed approaches, and durable fixes.

Before inventing a workaround for a bug, check whether `FIXES.md` already contains the answer.

## Project Structure

Each project lives under `projects/[name]/`.

### `projects/[name]/project/`

This is the actual software project.

### `projects/[name]/library/`

This is the project's durable knowledge base.

Keep at least:
- `decisions.md`
- `plans.md`
- `notes.md`
- `research.md`

Use these files deliberately:
- decisions that still matter go in `decisions.md`
- active or upcoming work planning goes in `plans.md`
- factual project notes go in `notes.md`
- references, comparisons, and external findings go in `research.md`

### `projects/[name]/work/`

This directory contains one subdirectory per task.

Use a slug for each task directory.
Preferred pattern:
- `[project-id]-[task-slug]`

Examples:
- `nx-013-build-pipeline`
- `api-auth-cleanup`
- `docs-release-prep`

If there is no project/task ID, use just the slug.

## Task Directory Structure

Each task directory must contain:
- `TASK.md`
- `HANDOFF.md`
- `CONTEXT.md`
- `runs/`

When creating a new task directory, initialize its files from:
- `framework/TEMPLATES/TASK.md`
- `framework/TEMPLATES/HANDOFF.md`
- `framework/TEMPLATES/CONTEXT.md`
- `framework/TEMPLATES/RUN-LOG.md` for new entries inside `runs/`

Do not invent task file formats ad hoc when the templates already apply.

### `TASK.md`

Static instructions for the task.

### `HANDOFF.md`

Current operational state.

Update this before ending a task session.

### `CONTEXT.md`

Stable facts for the task.

Do not put temporary status here.

### `runs/`

Append-only run logs for task sessions.

## What Goes Where

- current workspace priority → `ACTIVE-CONTEXT.md`
- daily progress summary → `memory/daily-brief-*.md`
- stable task facts → `projects/[name]/work/[task-slug]/CONTEXT.md`
- current task state → `projects/[name]/work/[task-slug]/HANDOFF.md`
- durable project knowledge → `projects/[name]/library/*.md`
- durable fixes and mistakes → `FIXES.md`
- exact historical recall → optional memory service

## End Of Session

Before ending a meaningful session:
1. update the relevant handoff or context files
2. append to today's daily brief
3. record durable fixes in `FIXES.md` when relevant
4. move lasting project knowledge into `projects/[name]/library/`

## Tool Agnosticism

Do not assume a specific:
- chat platform
- transcript format
- cron system
- model vendor
- web UI

Treat those as adapters outside the framework core.
