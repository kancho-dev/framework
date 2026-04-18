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

- `projects/[name]/work/[task-slug]/TASK.md`
- `projects/[name]/work/[task-slug]/HANDOFF.md`
- `projects/[name]/work/[task-slug]/CONTEXT.md`
- relevant project library files
- today's daily brief

## Steps

1. Confirm whether the task is complete, paused, or still active.
2. Update `HANDOFF.md` so it reflects the real current state rather than historical buildup.
3. Update `CONTEXT.md` only if stable task facts changed.
4. Move durable findings into project `library/` files or `FIXES.md` when needed.
5. Check whether the task status or outcome should be reflected in `ACTIVE-CONTEXT.md`.
6. Verify that meaningful runs and outcomes from the task have been recorded in the daily brief.
7. Write a final or intermediate run log that makes the task state obvious to the next session.

## Outputs

- a task directory whose status is clear
- durable knowledge moved into the right long-lived files
- daily brief coverage for meaningful task work

## Stop Conditions

- the next session can tell whether the task is complete, paused, or still active
- no important task outcome is trapped only in chat or stale handoff text
- meaningful work from the closure slice is reflected in the daily brief

## Pitfalls / Anti-Patterns

- calling a task done while `HANDOFF.md` still reads like active work
- leaving durable findings only in task files
- forgetting to log meaningful task outcomes in the daily brief
- preserving stale next-step lists after closure

## Related Files / Tools

- `projects/[name]/work/[task-slug]/`
- `projects/[name]/library/*.md`
- `ACTIVE-CONTEXT.md`
- `memory/daily-brief-YYYY-MM-DD.md`
- `FIXES.md`
