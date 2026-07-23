---
name: task-closure
description: "Reconcile a tracked task after acceptance, deliberate pause, concrete blockage, or wontfix decision."
---

# Skill: Task Closure

## Outcome

Reconcile one explicit task disposition across authoritative task state, evidence, durable knowledge, workspace state, and optional Task Browser metadata.

## Entry Contract

Use `task-pickup` for implementation, review handoff, or an incomplete/bounced slice. Run closure only when the task has one evidenced disposition: accepted completion, deliberate pause, concrete blockage, or explicit wontfix. Task-file semantics, review independence, Steering Notes, and the `nextActor` matrix remain owned by `TASKS.md`.

## Reconciliation Sequence

1. **Prove the disposition.** Read `TASK.md`, `HANDOFF.md`, `CONTEXT.md`, and the run evidence needed to test the claimed outcome against scope and acceptance criteria. Classify exactly one branch:

   | Branch | Required evidence | Lifecycle result |
   | --- | --- | --- |
   | Complete | Acceptance is recorded and the accepted scope has verification evidence. When review is required, an `approve` verdict is recorded. | `done` |
   | Pause | An explicit deferral decision and a resumable condition or trigger are recorded. | `paused` |
   | Blocked | A concrete unresolved blocker, its evidence, and the actor or external condition that can resolve it are recorded. | `blocked` |
   | Wontfix | An explicit decision, rationale, and disposition of the intended scope are recorded. | `done` |

   A bounced review, missing acceptance, failed check, partial slice, or vague blocker remains active and returns to `task-pickup`.
   - Complete when one branch and all of its required evidence are named, or closure has stopped with the missing evidence identified.
2. **Reconcile task truth.** Replace historical buildup in `HANDOFF.md` with the disposition, evidence summary, and only the next action or resume condition that still applies. Update `CONTEXT.md` only for stable facts. Write an append-only closure run log; preserve the run's required Steering Notes field rather than reconstructing it.
   - Complete when task markdown states the same disposition, evidence, and actionable remainder without stale next steps.
3. **Promote durable outcomes.** Update project `library/` files or `FIXES.md` only for knowledge that should outlive the task. Update `ACTIVE-CONTEXT.md` when the disposition changes shared priority, direction, or reported active state.
   - Complete when every durable outcome has one authoritative home and the end-of-session contract in `FRAMEWORK.md` is satisfied.
4. **Align optional metadata.** When Task Browser is in use, apply the lifecycle result from the branch table. Align `nextActor`, relationships, blockers, and provenance under the Task Browser contract in `TASKS.md`, then confirm the result with a fresh metadata read.
   - Complete when metadata matches `HANDOFF.md`, relationship changes are accounted for, and a fresh metadata read shows no contradiction.
5. **Audit the closure.** Re-read the compact handoff, run evidence, affected shared state, and metadata result. For a complete or wontfix branch, confirm no active next action survives; for pause, confirm the resume condition; for blocked, confirm the resolver and blocker.
   - Complete when another session can reproduce why this disposition is valid without relying on chat.

## Closure Complete When

- one supported disposition has all required evidence;
- `HANDOFF.md`, the closure run log, and optional metadata agree;
- status, `nextActor`, and task relationships satisfy their separate rules;
- stable knowledge and shared workspace state are updated only where the outcome requires it;
- the universal end-of-task persistence in `FRAMEWORK.md` and `TASKS.md` is complete;
- incomplete or bounced work has been routed back to `task-pickup` rather than closed.

## Companion Routing

- Use `task-pickup` to resume active work, implement review fixes, or prepare a review handoff.
- Use `review-and-test` when acceptance requires broader verification; approval remains a separate task run.
- Consult `TASKS.md` for task-file semantics, run-log requirements, review verdicts, Task Browser relationships, and the authoritative `nextActor` matrix.
