# Task Reference

Use this reference when creating, picking up, reviewing, or closing framework-managed tasks.

## Choose The Lightest Track That Fits

### Micro task

Tiny one-run work that does not justify a task directory.

Use for:

- quick answers;
- small inspections;
- trivial edits with no follow-up;
- minor state updates.

Durable trace:

- no task directory required;
- append the daily brief when the work is meaningful;
- update `ACTIVE-CONTEXT.md` when priorities, blockers, or direction change.

Micro tasks are intentionally lightweight. If future task-browser tooling needs complete visibility for tiny work, add a lightweight index later rather than forcing every small action into a task directory now.

### Tracked task

Use a task directory when work needs durable task state, handoff, review evidence, or future visibility.

Use for:

- multi-session work;
- delegated work;
- risky or review-loop work;
- durable project work;
- work that should appear in task/project tooling.

Task directory structure:

```text
projects/[name]/work/[task-slug]/
  TASK.md
  HANDOFF.md
  CONTEXT.md
  runs/
```

Initialize task files from:

- `framework/TEMPLATES/TASKS/TASK.md`
- `framework/TEMPLATES/TASKS/HANDOFF.md`
- `framework/TEMPLATES/TASKS/CONTEXT.md`
- `framework/TEMPLATES/TASKS/RUN-LOG.md`

Keep `HANDOFF.md` and `CONTEXT.md` as short as possible, but not shorter than needed for safe continuation. Add detail only when it improves handoff, stable context, or review evidence.

## Task Files

### `TASK.md`

Static instructions for the task: purpose, scope, desired outcome, constraints, acceptance criteria, and success criteria.

### `HANDOFF.md`

Current operational state. Update before ending a task session.

Keep it focused on what the next run needs immediately:

- current state;
- next action;
- blockers or watch-outs.

### `CONTEXT.md`

Stable facts that should survive across sessions. Do not put temporary status here.

Keep it concise. Add durable facts, decisions, constraints, references, or background only when they matter beyond the current run.

### `runs/`

Append-only run logs for task sessions and meaningful reviews.

### Additional task-local working files

Tasks may contain extra working files such as analysis notes, design drafts, migration comparisons, or larger exploratory material. Use this for task-local work that is too substantial for transient notes and not ready for durable project `library/` files.

### Optional `NOTES.md`

Transient next-run inbox for short-lived steering such as Operator nudges or review bounce notes.

If used:

1. read it at the start;
2. act on it during the run;
3. clear or consume it;
4. move anything still important into durable files.

Do not use task `NOTES.md` for long-term knowledge or as a substitute for workspace `OPERATOR-NOTES.md`.

## Task Directory Naming

Use a short descriptive slug.

Preferred pattern:

```text
[project-id]-[task-slug]
```

Examples:

- `#13-build-pipeline`
- `api-auth-cleanup`
- `docs-release-prep`

Rules:

- lowercase;
- words separated by `-`;
- include a project/task ID when one exists.

## Task Patterns

### Direct task

One focused run on bounded work.

### Task pickup

Resume an existing task from task files.

### Review loop

A Builder run produces a bounded slice, then a separate Oracle task run reviews it. The Oracle returns `approve`, `bounce`, or `needs clarification`.

### Maintenance

A Historian or Overseer run cleans state, syncs docs, or reduces drift.

### Research / plan

An Overseer run gathers evidence, clarifies scope, and prepares the next implementation slice.

## Builder–Oracle Loop

Use this as the default quality pattern when implementation work should be reviewed before being treated as complete.

1. The Operator or Overseer defines or clarifies the task.
2. Builder completes one bounded slice.
3. Builder records what changed, what was checked, and what remains.
4. Oracle reviews in a separate task run against the task goal and acceptance criteria.
5. Oracle records a durable review result unless the review is explicitly read-only/no-write.
6. Oracle returns a verdict: `approve`, `bounce`, or `needs clarification`.
7. If bounced, the next Builder fixes the listed issues and resubmits.

Keep meaningful Oracle reviews separate from Builder implementation runs. This preserves a clear quality gate and makes review evidence easy to find in task history.

A good review result includes:

- verdict;
- what was checked;
- findings;
- required fixes when not approved;
- confidence level when uncertainty remains.

For meaningful reviews, write a separate Oracle task run log, update `HANDOFF.md`, and append the daily brief. If a delegated/no-write reviewer cannot write files, the coordinating session should import the result.

## End Of Task Session

Before ending meaningful task work:

1. update the relevant handoff or context files;
2. write a run log when there is a task directory;
3. append today's daily brief with the real current time;
4. move durable knowledge to project `library/` or `FIXES.md` when relevant.
