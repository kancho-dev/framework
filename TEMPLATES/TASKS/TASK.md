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
- Optional transient steering: `NOTES.md`

## Desired Outcome

[State the concrete outcome this task should produce.]

## Constraints

- [Constraint or non-goal]
- [Constraint or non-goal]

## Acceptance Criteria

- [Concrete condition the result must satisfy]
- [Concrete condition the result must satisfy]

## Instructions To The Agent

1. Read `HANDOFF.md`.
2. Read `CONTEXT.md`.
3. If `NOTES.md` exists, read it early and treat it as transient next-run guidance.
4. Read relevant project files in `projects/[name]/project/`.
5. Continue the highest-priority incomplete work in scope.
6. Before ending, update `HANDOFF.md`.
7. Move stable facts into `CONTEXT.md` if needed.
8. If `NOTES.md` was used, clear or consume it during the run and move anything still important into durable files.
9. Write a run log in `runs/`.

## Success Criteria

- [What finished looks like]
- [What evidence or verification should exist]
