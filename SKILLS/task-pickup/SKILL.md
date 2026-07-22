---
name: task-pickup
description: "Pick up an existing tracked task by recovering its authoritative state and choosing one bounded next action."
---

# Skill: Task Pickup

## Outcome

Recover a tracked task without guessing, then complete or hand off one bounded action.

## Entry Contract

Choose the task action from authoritative task state and the current handoff. Task structure, Steering Notes semantics, independent-review rules, and the `nextActor` matrix remain owned by `TASKS.md`.

## Pickup Sequence

1. **Recover the contract.** Read `TASK.md`, `HANDOFF.md`, and `CONTEXT.md`. Check task-local `NOTES.md` exactly once at task-run start: missing or whitespace-only means no payload; when non-empty, capture it successfully, immediately delete the file, and apply the payload once within the durable task contract. Record a conflict and seek clarification before conflicting work. Read recent `runs/` evidence only when the handoff or selected action depends on it.
   - Complete when scope, current state, constraints, and the one-time Steering Notes result are known.
2. **Align pickup state.** When the workspace uses Task Browser, set the task to `active` unless its real state is already `blocked` or `review`. Compare metadata with `HANDOFF.md`; resolve discrepancies from task markdown and use the `TASKS.md` matrix to set or clear `nextActor` independently of status.
   - Complete when metadata reflects the real lifecycle state and responsible next actor, or Task Browser is not in use.
3. **Choose one bounded action.** Classify the task's current branch, then choose the highest-priority unfinished action established by task state:

   | Current branch | Bounded action |
   | --- | --- |
   | New or newly initialized task | Establish the first concrete implementation, documentation, research, or coordination deliverable from `TASK.md`. |
   | Resumed task | Continue the explicit `HANDOFF.md` next action, unless newer durable state makes it stale. |
   | Independent-review handoff | Independently verify the submitted slice against the task contract and recorded evidence; do not implement fixes in the same review run. |
   | Operator-blocked | Record the exact decision or input needed and stop without speculative work. |

   Read only project files required for that action. Follow `FRAMEWORK.md` and `TASKS.md` authority for the selected run and escalate when scope, risk, or acceptance criteria remain ambiguous.
   - Complete when one action has a named deliverable and a checkable finish condition.
4. **Execute and verify.** Complete only the selected action and run the smallest checks that establish its finish condition. Put newly discovered stable facts in `CONTEXT.md` or project knowledge only when they must survive the run.
   - Complete when the deliverable is verified or a concrete blocker is evidenced.
5. **Leave a resumable handoff.** Replace transient buildup in `HANDOFF.md` with current state, the next action, and blockers or watch-outs. Write an append-only run log with exactly one `Steering Notes: none` or `Steering Notes: consumed` field. Align Task Browser status and `nextActor` again; use `review` with Agent next for an independent-review handoff, `active` with Agent next after a review bounce, and the authoritative `TASKS.md` matrix for every other case.
   - Complete when task markdown, run evidence, and optional metadata agree and the next run can proceed without guessing.

## Pickup Complete When

- `TASK.md`, `HANDOFF.md`, and `CONTEXT.md` were read;
- `NOTES.md` was checked exactly once and its result is recorded once in the run log;
- Task Browser status and `nextActor` match the handoff when that tool is in use;
- one task-appropriate bounded action was completed or concretely blocked;
- verification evidence and the next action are durable in task files.

## Companion Routing

- Use `review-and-test` when the selected action needs a broader test plan; independent review still requires a separate task run.
- Use `task-closure` only after acceptance or an explicit pause/closure decision.
- Consult `TASKS.md` for task-file semantics, Steering Notes conflicts, review verdicts, and the authoritative `nextActor` matrix.
