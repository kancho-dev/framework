# [Task Name]

## Purpose

[State what this task exists to accomplish.]

## Scope

- [In-scope item]
- [In-scope item]

## Out Of Scope

- [Explicit non-goal]

## Inputs

- Code: `projects/[name]/project/`
- Knowledge: `projects/[name]/library/`
- Prior state: `HANDOFF.md`
- Stable facts: `CONTEXT.md`

## Instructions To The Agent

1. Read `HANDOFF.md`.
2. Read `CONTEXT.md`.
3. Read relevant project files in `projects/[name]/project/`.
4. Continue the highest-priority incomplete work in scope.
5. Before ending, update `HANDOFF.md`.
6. Move stable facts into `CONTEXT.md` if needed.
7. Write a run log in `runs/`.

## Success Criteria

- [What finished looks like]
