---
name: project-self-check
description: "Keep a project’s task state, library files, and key docs aligned with the actual state of the project."
---

# Skill: Project Self-Check

## Purpose

Keep a project’s task state, library files, and key docs aligned with the actual state of the project.

## When To Use

- during project maintenance
- after major implementation work
- when task files or library docs feel stale or duplicated
- before considering a project slice complete

## Recommended Roles

- Historian
- Overseer

## Required Inputs

- project task directories under `projects/[name]/work/`
- project library files
- relevant project docs and implementation state

## Steps

1. Review active task directories for stale or duplicate status.
2. Keep `HANDOFF.md` operational and `CONTEXT.md` stable.
3. Remove or summarize irrelevant task detail that no longer helps the next run.
4. Check whether durable knowledge belongs in `library/` rather than in task files.
5. Update project docs when they no longer match real project state.
6. Ensure any important completed work is reflected in the correct long-lived files.

## Outputs

- cleaner active task files
- more accurate project library and docs
- reduced duplication between task state and durable project knowledge

## Stop Conditions

- active project files reflect current reality with less duplication
- stable knowledge is stored in the correct long-lived location

## Pitfalls / Anti-Patterns

- keeping finished details in handoffs forever
- duplicating the same fact across context, handoff, and library files
- updating docs without checking current implementation/state

## Related Files / Tools

- `projects/[name]/work/`
- `projects/[name]/library/`
- `projects/[name]/project/README.md`
