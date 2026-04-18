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

## Runtime Model

Use this runtime model for every run:

```text
Run = Base + Role + Skills + Context
```

- **Base** = always-read framework files
- **Role** = the primary mindset, scope, and constraints for the run
- **Skills** = optional procedural playbooks loaded only when relevant
- **Context** = the smallest set of workspace, task, and project files needed for the run
- **Optional memory retrieval** = use the memory CLI only when current markdown files are not enough and a specific context gap remains

## Read Order

### Main session

Read in this order:
1. `framework/FRAMEWORK.md`
2. `framework/SECURITY.md`
3. `framework/ENGINEERING.md`
4. `framework/ROLES/OVERSEER.md`
5. `ACTIVE-CONTEXT.md`
6. today's `memory/daily-brief-YYYY-MM-DD.md` if it exists
7. relevant files under `projects/[name]/library/`
8. only the role-relevant skills and extra context needed for the run
9. if a specific context gap remains, optionally use `framework/SKILLS/memory-search.md` and the memory CLI under `framework/memory-service/`

### Task session

If you are working on a task under `projects/[name]/work/[task-slug]/`, read in this order:
1. `framework/FRAMEWORK.md`
2. `framework/SECURITY.md`
3. `framework/ENGINEERING.md`
4. the role file for the run under `framework/ROLES/`
5. `projects/[name]/work/[task-slug]/TASK.md`
6. `projects/[name]/work/[task-slug]/HANDOFF.md`
7. `projects/[name]/work/[task-slug]/CONTEXT.md`
8. relevant files under `projects/[name]/library/`
9. only the skills and extra context needed for the run
10. if a specific context gap remains, optionally use `framework/SKILLS/memory-search.md` and the memory CLI under `framework/memory-service/`

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

## Repository Structure

Recommended default:
- the workspace root has its own git repository for coordination files
- `framework/` stays as its own git repository
- each project under `projects/[name]/` has its own git repository

This separation lets the workspace track shared operational state without mixing framework history or project history into the same repository.

If you use this model, configure the workspace root repository to ignore nested repositories such as:
- `framework/`
- `projects/*/`

### `projects/[name]/project/`

This is the actual software project.

Create a simple `projects/[name]/README.md` when initializing a new project.

It should briefly explain:
- what the project is
- the current scope or goal
- the purpose of `project/`, `library/`, and `work/`

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

### Optional `NOTES.md`

Tasks may also use an optional `NOTES.md` file as a transient inbox for the next run.

Use it only for short-lived steering such as:
- temporary operator instructions
- review bounce notes
- next-run corrections or priority nudges

If used, the task run should:
1. read `NOTES.md` at the start
2. act on its contents during the session
3. clear or consume it during that run
4. move anything still important into durable files such as `HANDOFF.md`, `CONTEXT.md`, project `library/`, or `FIXES.md`

Do not use `NOTES.md` for long-term knowledge.

## Task Patterns

Use the lightest task pattern that fits the work.

### Direct Task

One focused run on a bounded task.

### Task Pickup

Resume an existing task from `TASK.md`, `HANDOFF.md`, and `CONTEXT.md`.

### Review Loop

A Builder run produces a bounded slice, then an Oracle run reviews it.
The Oracle should either:
- approve it, or
- bounce it back with specific required fixes

### Maintenance

A Historian or Overseer run cleans state, syncs docs, or reduces drift.

### Research / Plan

An Overseer run gathers evidence, clarifies scope, and prepares the next implementation slice.

## Builder–Oracle Loop

Use this as the default quality pattern when implementation work should be reviewed before being treated as complete.

1. the user or Overseer defines or clarifies the task
2. the Builder completes one bounded slice
3. the Builder records what changed, what was checked, and what remains
4. the Oracle reviews against the task goal and acceptance criteria
5. the Oracle returns a verdict:
   - approve
   - bounce
   - needs clarification
6. if bounced, the next Builder run fixes the listed issues and resubmits

The goal is a clear review loop, not vague completion claims.

## Acceptance Criteria

When creating or refining a task, prefer making these explicit:
- desired outcome
- constraints
- acceptance criteria
- evidence or verification expectations

This helps Builders stay in scope and helps Oracles review against something concrete.

## What Goes Where

- current workspace priority → `ACTIVE-CONTEXT.md`
- daily progress summary → `memory/daily-brief-*.md`
- stable task facts → `projects/[name]/work/[task-slug]/CONTEXT.md`
- current task state → `projects/[name]/work/[task-slug]/HANDOFF.md`
- durable project knowledge → `projects/[name]/library/*.md`
- durable fixes and mistakes → `FIXES.md`
- exact historical recall → optional memory service

## Escalation Flow

Use the smallest sensible escalation path when uncertainty blocks progress.

Default ladder:
- **Operator** → the human/user
- **Overseer** → top-level coordinator
- **Worker** → Builder, Oracle, or Historian working inside task scope
- **Approval gates** → explicit human approval for risky, destructive, or elevated actions

Rules:
- when a **worker** is uncertain, blocked, or missing a decision, escalate one level up to **Overseer**
- when **Overseer** is uncertain, blocked, or missing user intent, escalate one level up to the **Operator**
- do not guess when a missing decision could change scope, correctness, or risk
- prefer a concise explicit question over silent assumption-making
- if the issue should persist across runs, record it in task or workspace state files

## Review Guidance

For review-oriented runs, prefer structured verdicts.

A good review result includes:
- **Verdict:** approve / bounce / needs clarification
- **Checked:** what was actually reviewed or run
- **Findings:** what passed, failed, or remains uncertain
- **Required fixes:** only when not approved
- **Confidence:** high / medium / low when uncertainty remains

## End Of Session

Before ending a meaningful session:
1. update the relevant handoff or context files
2. append to today's daily brief
3. record durable fixes in `FIXES.md` when relevant
4. move lasting project knowledge into `projects/[name]/library/`

## Roles And Skills

### Roles

Use one primary role per run.

Default roles:
- `framework/ROLES/OVERSEER.md` — top-level orchestration, planning, and review
- `framework/ROLES/BUILDER.md` — implementation work
- `framework/ROLES/ORACLE.md` — review and verification
- `framework/ROLES/HISTORIAN.md` — documentation and state hygiene

The default top-level session role is **Overseer**.

### Skills

Skills are optional playbooks under `framework/SKILLS/`.

Load them only when they help with the current run.
Do not read every skill by default.

### Optional Memory Retrieval

If current markdown files do not answer a specific context question, use `framework/SKILLS/memory-search.md` before doing broad manual history recovery.

Use the memory CLI under `framework/memory-service/` selectively, for example:
- `mem search "query"` — recover prior discussion or implementation context
- `mem recent 20` — fast catch-up on recent conversation history
- `mem sessions` — identify recent sessions and their trace hints
- `mem lessons search "query"` — check for past mistakes, gotchas, or durable fixes before risky work

Treat memory retrieval as optional support, not as the source of truth for current policy or current state.

## Tool Agnosticism

Do not assume a specific:
- chat platform
- transcript format
- cron system
- model vendor
- web UI

Treat those as adapters outside the framework core.
