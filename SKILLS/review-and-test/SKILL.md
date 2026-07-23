---
name: review-and-test
description: "Review a completed change against both its intended specification and repository standards, test the highest-risk claims, and return an evidence-backed verdict."
---

# Skill: Review And Test

## Use When

- independently reviewing a completed task slice;
- self-checking implementation before an independent-review handoff;
- rechecking an approved change after an adjustment.

## Review Mode

Select exactly one mode from the request and task state before reviewing:

- **Implementation self-check:** verify completed work, update implementation evidence, and hand off for a separate independent review without recording approval.
- **Independent review:** verify the submitted boundary independently and return the formal verdict required by the task contract.

If the mode is absent or ambiguous, return `needs clarification` with the missing input. Do not convert a self-check into independent approval within the same run.

## Required Inputs

- the change boundary: working-tree diff, commit range, or explicit artifacts;
- the task, issue, specification, or stated outcome;
- repository instructions and standards that govern the changed files;
- implementation claims and existing test evidence, when available.

If the boundary or intended outcome cannot be identified, return `needs clarification` with the missing input. Do not infer an approval target.

## Review

### 1. Pin the review contract

Record the review mode, change boundary, intended outcome, acceptance criteria, applicable standards, and excluded scope. Inspect task state and recent run evidence only when they affect that contract.

**Complete when:** the mode is explicit, every changed artifact is inside the boundary, and every acceptance criterion has a source, or each missing source is named as an uncertainty.

### 2. Review two axes

Keep the findings separate so one axis cannot mask the other:

- **Spec:** map each acceptance criterion to the changed behavior and evidence. Flag missing, partial, incorrect, or out-of-scope behavior.
- **Standards:** inspect the same boundary against repository instructions, safety rules, architecture, tests, documentation ownership, and harmful duplication. Distinguish documented violations from judgment calls.

Repository rules are authoritative. Load branch-specific references only when a changed artifact or criterion requires them.

**Complete when:** every criterion has a pass/fail/uncertain disposition and every changed artifact has been checked against its applicable standards.

### 3. Test risk-first

Run the smallest checks that directly exercise the highest-risk claims, then broaden only where failures, coupling, or the task contract justify it. Inspect commands before execution and follow repository security guidance. Record the exact command or inspection, result, and any limitation; prior implementation evidence is a lead, not independent-review proof.

For non-executable documentation or workflow changes, use representative walkthroughs plus focused searches for stale competing guidance, branch omissions, public-safety leaks, and ownership drift. Include applicable automated checks and `git diff --check`.

**Complete when:** each consequential claim has direct evidence or an explicit evidence gap, and every executed check has an observed result.

### 4. Reconcile findings into one verdict

Use the most severe supported disposition:

- **approve:** both axes pass, required checks pass, and no material evidence gap remains;
- **bounce:** a reproducible defect, unmet criterion, standards violation, regression, or required-check failure has an actionable fix;
- **needs clarification:** missing or conflicting authority prevents a fair pass/fail decision.

Report:

- **Verdict:** approve / bounce / needs clarification
- **Boundary:** reviewed diff, range, or artifacts
- **Spec:** criterion dispositions and evidence
- **Standards:** findings and evidence
- **Tests:** checks, results, and limitations
- **Required fixes:** only for `bounce`
- **Clarification needed:** only for `needs clarification`
- **Confidence:** high / medium / low, with the reason when below high

**Complete when:** the verdict follows the rules above, every material finding points to evidence, and the next action is unambiguous.

## Persist The Outcome

An implementation self-check updates implementation evidence and hands off to a separate independent-review run without recording approval.

For a meaningful independent task review, use a separate Task Run under the review authority defined by `FRAMEWORK.md` and `TASKS.md`. Persist the review under the review and end-of-task contracts in `TASKS.md`. On `approve`, hand to the Operator when acceptance is still required; on `bounce`, hand to implementation; on `needs clarification`, hand to the actor who owns the missing decision.

**Complete when:** the selected mode's authority was preserved and durable task state, narrative next action, and `nextActor` agree, or the review was explicitly read-only and the report names who must persist it.

## Companion Routing

- Return incomplete or bounced implementation to `task-pickup` for the next bounded implementation slice.
- Use `task-closure` only after the required acceptance or other closure disposition exists.
