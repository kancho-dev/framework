---
name: task-pickup
description: "Resume an existing task cleanly by recovering current state, selecting the next bounded step, and preparing a clear handoff for the following run."
---

# Skill: Task Pickup

## Purpose

Resume an existing tracked task cleanly by recovering current state, selecting the next bounded step, and preparing a clear handoff for the following run.

## When To Use

- continuing work under `projects/[name]/work/[task-slug]/`
- delegated implementation sessions
- resuming work after interruption or context loss

## Recommended Roles

- Builder
- Historian
- Oracle, when the task is review-focused

## Required Inputs

- `TASK.md`
- `HANDOFF.md`
- `CONTEXT.md`
- relevant project files
- optional `NOTES.md` if the task flow adopts it
- existing files under `runs/` when recent run evidence matters

## Steps

1. Read `TASK.md` to confirm the task scope and success criteria.
2. Read `HANDOFF.md` for current operational state.
3. Read `CONTEXT.md` for stable task facts.
4. Read only the project files needed for the next likely step.
5. Identify the highest-priority unfinished in-scope action.
6. Complete one bounded slice rather than partially touching multiple areas.
7. Before ending, update `HANDOFF.md` with current state, what changed, and the next action.
8. If the workspace uses task-browser metadata, align the task's metadata with the real state using `framework/tools/task-browser/metadata-cli.mjs`; for example set the picked-up task to `active`, `blocked`, or `review` as appropriate. In framework versions with task-browser action history, pass real provenance such as `--role Builder`, `--session-tool pi`, or `--session-id ...` when useful and available; leave provenance unset rather than inventing it.
9. Move any newly discovered stable facts into `CONTEXT.md` or project library files as appropriate.
10. Write a run log.

## Outputs

- one completed bounded task slice or a clearly documented blocker
- updated task handoff
- updated stable task facts when needed
- task-browser metadata aligned when the workspace uses task-browser
- a run log entry

## Stop Conditions

- the current slice is complete or a real blocker is documented
- the next run can continue from files without guessing

## Pitfalls / Anti-Patterns

- skipping `HANDOFF.md`
- letting `HANDOFF.md` become historical buildup instead of current operational state
- putting temporary status in `CONTEXT.md`
- changing scope without updating task state
- leaving task-browser metadata stale in workspaces that use the task-browser board
- leaving partial work without recording what remains
- reading too much irrelevant project code before choosing a step

## Related Files / Tools

- `framework/TASKS.md`
- `projects/[name]/work/[task-slug]/TASK.md`
- `projects/[name]/work/[task-slug]/HANDOFF.md`
- `projects/[name]/work/[task-slug]/CONTEXT.md`
- `projects/[name]/work/[task-slug]/runs/`
- `framework/tools/task-browser/metadata-cli.mjs` when task-browser metadata is used
