# Skill: Next Best Actions

## Purpose

Identify the highest-value next actions from the current workspace or project state without loading unnecessary context.

## When To Use

- top-level sessions
- planning the next slice of work
- recovering after a pause or context loss
- deciding whether to continue, delegate, review, or clean up

## Recommended Roles

- Overseer

## Required Inputs

- `ACTIVE-CONTEXT.md`
- `OPERATOR-NOTES.md` when the run may benefit from Operator todos, ideas, or workspace-level human notes
- today's daily brief if present, otherwise the latest daily brief file if any exist
- relevant task handoffs or project library files when needed

## Steps

1. Read the smallest set of current-state files that can explain what is active.
2. If useful for the run, scan `OPERATOR-NOTES.md` for human todos, ideas, or pending decisions that may affect prioritization.
3. Identify what is already in progress, what is blocked, and what is effectively complete.
4. Prefer actions that remove ambiguity, unlock work, or finish an active slice before creating new work.
5. If multiple paths are possible, choose the one with the best value-to-complexity ratio.
6. State the next actions explicitly and in priority order.
7. Update coordination files if the real priority changed.

## Outputs

- a short prioritized next-step list
- updated active state if priorities changed

## Stop Conditions

- the next actions are explicit and grounded in current state
- relevant coordination files reflect the current priority

## Pitfalls / Anti-Patterns

- reading too much history before choosing the next step
- proposing speculative work while active work is unfinished
- leaving decisions only in chat instead of files

## Related Files / Tools

- `ACTIVE-CONTEXT.md`
- `OPERATOR-NOTES.md`
- `projects/[name]/library/plans.md`
- `projects/[name]/work/[task-slug]/HANDOFF.md`
