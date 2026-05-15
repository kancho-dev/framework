---
name: task-closure
description: "Close or pause a task cleanly by making sure its final state is reflected in task files, project knowledge, and shared workspace logs."
---

# Skill: Task Closure

## Purpose

Close or pause a task cleanly by making sure its final state is reflected in task files, project knowledge, and shared workspace logs.

## When To Use

- when a task is complete for its intended scope
- when a task should be paused with a clean handoff
- after a meaningful implementation or review slice that changes the task status

## Recommended Roles

- Overseer
- Historian

## Required Inputs

For every task:

- `projects/[name]/work/[task-slug]/TASK.md`
- relevant project library files
- today's daily brief

For full tasks, also use when present:

- `projects/[name]/work/[task-slug]/HANDOFF.md`
- `projects/[name]/work/[task-slug]/CONTEXT.md`

## Steps

1. Confirm whether the task is minimal or full, and whether it is complete, paused, blocked, or still active.
2. For a full task:
   - update `HANDOFF.md` so it reflects the real current state rather than historical buildup;
   - update `CONTEXT.md` only if stable task facts changed.
3. For a minimal task:
   - update `TASK.md` status, `Next`, and `Result / Notes` so the task's state is obvious;
   - promote it to a full task if closure revealed multi-session, delegated, blocked, risky, review-heavy, or context-rich work.
4. Move durable findings into project `library/` files or `FIXES.md` when needed.
5. Check whether the task status or outcome should be reflected in `ACTIVE-CONTEXT.md`.
6. Verify that meaningful runs and outcomes from the task have been recorded in the daily brief.
7. Write a final or intermediate run log when the task has a `runs/` directory or when the closure work is meaningful.

## Outputs

- a task directory whose status is clear
- task state updated in `HANDOFF.md` for full tasks or `TASK.md` for minimal tasks
- durable knowledge moved into the right long-lived files
- daily brief coverage for meaningful task work

## Stop Conditions

- the next session can tell whether the task is complete, paused, blocked, or still active
- no important task outcome is trapped only in chat or stale task text
- meaningful work from the closure slice is reflected in the daily brief

## Pitfalls / Anti-Patterns

- assuming every task has `HANDOFF.md` and `CONTEXT.md`
- calling a task done while `HANDOFF.md` or minimal `TASK.md` still reads like active work
- leaving durable findings only in task files
- forgetting to log meaningful task outcomes in the daily brief
- preserving stale next-step lists after closure

## Related Files / Tools

- `framework/TASKS.md`
- `projects/[name]/work/[task-slug]/`
- `projects/[name]/library/*.md`
- `ACTIVE-CONTEXT.md`
- `memory/daily-brief-YYYY-MM-DD.md`
- `FIXES.md`
