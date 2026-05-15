---
name: task-pickup
description: "Resume an existing task cleanly by recovering current state, selecting the next bounded step, and preparing a clear handoff for the following run."
---

# Skill: Task Pickup

## Purpose

Resume an existing task cleanly by recovering current state, selecting the next bounded step, and preparing a clear handoff for the following run.

## When To Use

- continuing work under `projects/[name]/work/[task-slug]/`
- delegated implementation sessions
- resuming work after interruption or context loss

## Recommended Roles

- Builder
- Historian
- Oracle, when the task is review-focused

## Required Inputs

For every task:

- `TASK.md`
- relevant project files

For full tasks, also use when present:

- `HANDOFF.md`
- `CONTEXT.md`

Optional:

- `NOTES.md` if the task flow adopts it
- existing files under `runs/`

## Steps

1. Read `TASK.md` to confirm the task scope, tracking type, and success criteria.
2. Determine whether the task is minimal or full:
   - minimal tasks may have only `TASK.md` and `runs/`;
   - full tasks use `TASK.md`, `HANDOFF.md`, `CONTEXT.md`, and `runs/`.
3. For a full task, read `HANDOFF.md` for current operational state and `CONTEXT.md` for stable task facts.
4. For a minimal task, use `TASK.md` sections such as `Next` and `Result / Notes` as the compact state source.
5. Read only the project files needed for the next likely step.
6. Identify the highest-priority unfinished in-scope action.
7. Promote a minimal task to a full task if it has become multi-session, delegated, blocked, risky, review-heavy, or rich in stable context.
8. Complete one bounded slice rather than partially touching multiple areas.
9. Before ending:
   - for a full task, update `HANDOFF.md` and move stable facts into `CONTEXT.md` or project library files as appropriate;
   - for a minimal task, update `TASK.md` with the current next action and result/notes.
10. Write a run log when the task has a `runs/` directory or when the work is meaningful.

## Outputs

- one completed bounded task slice or a clearly documented blocker
- updated task state in `HANDOFF.md` for full tasks or `TASK.md` for minimal tasks
- updated stable task facts when needed
- a run log entry when applicable

## Stop Conditions

- the current slice is complete or a real blocker is documented
- the next run can continue from files without guessing
- any minimal task that outgrew compact tracking has been promoted or explicitly marked for promotion

## Pitfalls / Anti-Patterns

- assuming every task has `HANDOFF.md` and `CONTEXT.md`
- skipping `HANDOFF.md` on full tasks
- leaving a minimal task's `Next` or `Result / Notes` stale
- changing scope without updating task state
- leaving partial work without recording what remains
- reading too much irrelevant project code before choosing a step

## Related Files / Tools

- `framework/TASKS.md`
- `projects/[name]/work/[task-slug]/TASK.md`
- `projects/[name]/work/[task-slug]/HANDOFF.md` for full tasks
- `projects/[name]/work/[task-slug]/CONTEXT.md` for full tasks
- `projects/[name]/work/[task-slug]/runs/`
