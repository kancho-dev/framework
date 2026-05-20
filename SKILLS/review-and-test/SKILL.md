---
name: review-and-test
description: "Verify whether work actually satisfies the intended outcome and acceptance criteria, then return a structured verdict."
---

# Skill: Review And Test

## Purpose

Verify whether work actually satisfies the intended outcome and acceptance criteria, then return a structured verdict.

## When To Use

- review sessions
- post-implementation verification
- bounce/approve loops
- checking whether a task slice is truly done

## Recommended Roles

- Oracle
- Builder, for self-check before handoff

## Required Inputs

- task goal and scope
- acceptance criteria, if available
- claimed changes or artifacts to review
- relevant tests, commands, or inspection paths

## Steps

1. Restate the expected outcome before reviewing.
2. Identify the best available evidence sources: tests, builds, commands, UI checks, code inspection, docs, or task files.
3. Run or inspect the most relevant checks first.
4. Compare the observed result against the acceptance criteria or stated goal.
5. Record any gaps, regressions, uncertainty, or missing evidence.
6. Check for harmful duplication across the work being reviewed: copied logic, validation rules, docs procedures, config, schemas, commands, task state, or project facts that should have one authoritative source. Distinguish this from deliberate local repetition that improves clarity, tests, migration safety, onboarding, or agent reliability.
7. Return a structured verdict:
   - **Verdict:** approve / bounce / needs clarification
   - **Checked:** what was reviewed or run
   - **Findings:** issues, risks, or confirmation
   - **Required fixes:** only when not approved
   - **Confidence:** high / medium / low
8. For meaningful Oracle task reviews, keep the review as a separate Oracle task run when possible. If write-capable, record a run log, update task state, append the daily brief, and align task-browser metadata when the workspace uses task-browser unless the review is explicitly read-only/no-write. Typical metadata outcomes are `done` after approval/closure, `active` after a bounce, and `review` when review is still pending. In framework versions with task-browser action history, pass real provenance such as `--role Oracle` and actual session details when useful and available; leave provenance unset rather than inventing it.

## Outputs

- a clear review verdict
- evidence of what was checked
- actionable fixes when bouncing work
- durable review state for meaningful write-capable Oracle reviews
- task-browser metadata aligned with the review verdict when the workspace uses task-browser

## Stop Conditions

- the verdict is explicit
- the next run knows whether to proceed, fix, or clarify

## Pitfalls / Anti-Patterns

- approving on intuition instead of evidence
- vague feedback like "needs work"
- silently expanding the task beyond its actual goal
- claiming verification without actually checking
- demanding abstraction for every repeated phrase instead of identifying harmful duplicate authority
- mixing meaningful Oracle review evidence into the Builder implementation run instead of a separate Oracle run when one is practical
- bouncing or approving work while task-browser metadata still suggests the opposite state

## Related Files / Tools

- `framework/TASKS.md`
- `projects/[name]/work/[task-slug]/TASK.md`
- `projects/[name]/work/[task-slug]/HANDOFF.md`
- `projects/[name]/work/[task-slug]/runs/`
- project tests/build commands
- `framework/tools/task-browser/metadata-cli.mjs` when task-browser metadata is used
