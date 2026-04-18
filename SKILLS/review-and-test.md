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
6. Return a structured verdict:
   - **Verdict:** approve / bounce / needs clarification
   - **Checked:** what was reviewed or run
   - **Findings:** issues, risks, or confirmation
   - **Required fixes:** only when not approved
   - **Confidence:** high / medium / low

## Outputs

- a clear review verdict
- evidence of what was checked
- actionable fixes when bouncing work

## Stop Conditions

- the verdict is explicit
- the next run knows whether to proceed, fix, or clarify

## Pitfalls / Anti-Patterns

- approving on intuition instead of evidence
- vague feedback like "needs work"
- silently expanding the task beyond its actual goal
- claiming verification without actually checking

## Related Files / Tools

- `projects/[name]/work/[task-slug]/TASK.md`
- `projects/[name]/work/[task-slug]/HANDOFF.md`
- project tests/build commands
