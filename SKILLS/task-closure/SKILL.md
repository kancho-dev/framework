---
name: task-closure
description: "Close or pause a task cleanly by making sure its final state is reflected in task files, project knowledge, and shared workspace logs."
---

# Skill: Task Closure

## Purpose

Close or pause a tracked task cleanly by making sure its final state is reflected in task files, project knowledge, and shared workspace logs.

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

1. Confirm whether the task is complete, paused, blocked, or still active.
2. Update `HANDOFF.md` so it reflects the real current state rather than historical buildup.
3. Update `CONTEXT.md` only if stable task facts changed.
4. Move durable findings into project `library/` files or `FIXES.md` when needed.
5. Check whether the task status or outcome should be reflected in `ACTIVE-CONTEXT.md`.
6. Verify that meaningful runs and outcomes from the task have been recorded as timed entries appended to the end of today's daily brief.
7. If the workspace uses task-browser metadata, align it with the closure state using `framework/tools/task-browser/metadata-cli.mjs`: `done` for accepted closure, `paused` for deliberate deferral, `blocked` only for concrete blockers, and `review` when closure still awaits review. Also align `nextActor` with `HANDOFF.md`: clear it for done, paused, external/no-action states; set it for a concrete Operator/Agent blocker or pending review according to the authoritative matrix in `framework/TASKS.md`. Do not infer it from status. In framework versions with task-browser action history, pass real provenance such as the current role/session tool/session ID when useful and available; leave provenance unset rather than inventing it.
8. Write a final or intermediate run log that makes the task state obvious to the next session.

## Outputs

- a task directory whose status is clear
- current task state in `HANDOFF.md`
- stable task facts in `CONTEXT.md` when needed
- durable knowledge moved into the right long-lived files
- daily brief coverage for meaningful task work
- task-browser metadata aligned when the workspace uses task-browser

## Stop Conditions

- the next session can tell whether the task is complete, paused, blocked, or still active
- no important task outcome is trapped only in chat or stale task text
- meaningful work from the closure slice is reflected in the daily brief
- task-browser metadata, when used, does not contradict the task files

## Pitfalls / Anti-Patterns

- calling a task done while `HANDOFF.md` still reads like active work
- preserving stale next-step lists after closure
- putting temporary status in `CONTEXT.md`
- leaving durable findings only in task files
- forgetting to log meaningful task outcomes in the daily brief
- closing or pausing a task while task-browser metadata still shows the old state

## Related Files / Tools

- `framework/TASKS.md`
- `projects/[name]/work/[task-slug]/`
- `projects/[name]/library/*.md`
- `ACTIVE-CONTEXT.md`
- `memory/daily-brief-YYYY-MM-DD.md`
- `FIXES.md`
- `framework/tools/task-browser/metadata-cli.mjs` when task-browser metadata is used
