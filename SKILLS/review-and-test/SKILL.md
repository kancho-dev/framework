---
name: review-and-test
description: "Review a completed change against both its intended specification and repository standards, test the highest-risk claims, and return an evidence-backed verdict."
---

# Skill: Review And Test

## Use When

- an Oracle independently reviews a completed task slice;
- a Builder self-checks completed work before Oracle handoff;
- an approved change is rechecked after an adjustment.

Role selection happens during framework bootstrap. Consume the selected Oracle or Builder role; this skill does not select or load roles.

## Required Inputs

- the change boundary: working-tree diff, commit range, or explicit artifacts;
- the task, issue, specification, or stated outcome;
- repository instructions and standards that govern the changed files;
- implementation claims and existing test evidence, when available.

If the boundary or intended outcome cannot be identified, return `needs clarification` with the missing input. Do not infer an approval target.

## Review

### 1. Pin the review contract

Record the change boundary, intended outcome, acceptance criteria, applicable standards, and excluded scope. Inspect task state and recent run evidence only when they affect that contract.

**Complete when:** every changed artifact is inside the boundary and every acceptance criterion has a source, or each missing source is named as an uncertainty.

### 2. Review two axes

Keep the findings separate so one axis cannot mask the other:

- **Spec:** map each acceptance criterion to the changed behavior and evidence. Flag missing, partial, incorrect, or out-of-scope behavior.
- **Standards:** inspect the same boundary against repository instructions, safety rules, architecture, tests, documentation ownership, and harmful duplication. Distinguish documented violations from judgment calls.

Repository rules are authoritative. Load branch-specific references only when a changed artifact or criterion requires them.

**Complete when:** every criterion has a pass/fail/uncertain disposition and every changed artifact has been checked against its applicable standards.

### 3. Test risk-first

Run the smallest checks that directly exercise the highest-risk claims, then broaden only where failures, coupling, or the task contract justify it. Inspect commands before execution and follow repository security guidance. Record the exact command or inspection, result, and any limitation; prior Builder evidence is a lead, not Oracle proof.

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

A Builder self-check remains a Builder run: update implementation evidence and hand off to a separate Oracle without recording Oracle approval.

For a meaningful Oracle task review, use a separate Oracle Task Run. Record the verdict in a run log, update `HANDOFF.md`, append the daily brief, and align Task Browser metadata with `framework/TASKS.md`. On `approve`, hand to the Operator when acceptance is still required; on `bounce`, hand to Builder; on `needs clarification`, hand to the actor who owns the missing decision.

**Complete when:** durable task state, narrative next action, and `nextActor` agree, or the review was explicitly read-only and the report names who must persist it.

## Companion Routing

- Return incomplete or bounced implementation to `task-pickup` for the next bounded Builder slice.
- Use `task-closure` only after the required acceptance or other closure disposition exists.
