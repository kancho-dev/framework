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
- Optional task-local working files when the task needs larger draft or analysis material

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
3. Check `NOTES.md` exactly once at task-run start. If it contains non-whitespace Steering Notes, read and capture the payload successfully, immediately delete `NOTES.md`, and act on it once; do not poll during the run.
4. Read relevant project files in `projects/[name]/project/`.
5. Continue the highest-priority incomplete work in scope.
6. Before ending, update `HANDOFF.md`.
7. Move stable facts into `CONTEXT.md` if needed.
8. Move only lasting Steering Notes effects into durable files; conflicting scope, constraints, or security guidance require durable capture and Operator clarification before conflicting work.
9. Write a run log in `runs/` with `Steering Notes: none` or `Steering Notes: consumed`.

## Success Criteria

- [What finished looks like]
- [What evidence or verification should exist]
