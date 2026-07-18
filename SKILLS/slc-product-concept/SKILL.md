---
name: slc-product-concept
description: "Shape a product, design, or implementation idea as Simple, Lovable, and Complete before planning execution."
---

# Skill: SLC Product Concept

## Purpose

Shape a product/tool concept, design/architecture specification, or implementation slice as Simple, Lovable, and Complete (SLC). Use this before execution to define a narrow v1 that is valuable on its own, not an unfinished fragment of a larger promise.

Keep the workflow lightweight. The result is a concise shaping artifact, not automatically a PRD, architecture document, or implementation plan.

## When To Use

- exploring a product, tool, or prototype idea
- narrowing a design or architecture decision into a complete specification
- scoping a useful, reviewable implementation change
- testing whether a proposed first release or slice is coherent and bounded

## Recommended Roles

- Overseer for concept shaping and task scoping
- Builder for shaping an implementation slice or writing a durable artifact
- Oracle for a separate review when the result will guide meaningful execution

## Required Inputs

- the idea, problem, design question, or implementation goal
- the intended audience and job, if known
- relevant constraints and prior decisions
- the intended output location, if a durable artifact was requested

Do not invent missing product, design, or scope decisions. State a reasonable assumption when it is safe to proceed; ask the Operator when ambiguity would materially change the slice.

## Modes And SLC Meaning

Choose one mode. The audience is the person whose experience determines whether the slice is lovable and complete.

| Mode | Audience and job | Simple | Lovable | Complete | Appropriate validation evidence |
|---|---|---|---|---|---|
| **Product/tool concept** | A target user trying to accomplish a user-facing job | One short end-to-end workflow, narrow audience, and modest promise | A specific reason to choose or enjoy it, such as workflow fit, speed, trust, identity, delight, or craft | The promised job works from entry to useful outcome even if no v2 ships | Preliminary proxies such as observed workflows, prototype/demo feedback, and adoption intent can de-risk the concept; ultimate product learning comes from real target customers using the released product and demonstrating that its value and source of love matter |
| **Design/architecture specification** | Implementers, maintainers, reviewers, or integrators who must understand and use a decision | One bounded decision or interface with only the context needed to apply it | Clear ergonomics, reduced downstream complexity, strong defaults, inspectability, or another concrete benefit for that audience | Material interfaces, behavior, tradeoffs, failure cases, and excluded complexity are resolved enough for downstream work without guessing | Review or spikes that test interface clarity, tradeoffs, feasibility, failure handling, maintainability, and downstream complexity |
| **Implementation slice** | Users or developers who will use, operate, review, or maintain the change | The smallest shippable behavior change with a focused diff | A noticeable outcome such as smoother workflow, clearer feedback, safer behavior, faster operation, or better developer ergonomics | Behavior, relevant edge cases, tests, docs, and polish needed for this bounded promise ship together | Working behavior plus mode-appropriate tests, manual checks, docs/build checks, reviewability, and evidence of the claimed user or developer outcome |

Across all modes:

- **Simple** means deliberately narrow and easy to explain, execute, and validate.
- **Lovable** means one or more explicit sources of value or affinity for the mode's audience, not generic polish.
- **Complete** means the narrow promise stands alone. It is v1 of something simple, not v0.1 of something broken.

## Procedure

### 1. Frame The Request

Identify the mode, audience, job, constraints, and desired artifact. Write the idea in one sentence. Load only the project/task context needed to avoid contradicting known decisions.

**Complete when:** the artifact names one mode, one primary audience, one bounded job or decision, and any material unknown is either an explicit assumption or an Operator question.

### 2. Define The Narrow Promise

State the smallest workflow, decision, or behavior that could stand on its own. Name the source(s) of love and why they matter to the audience. Explain what makes the promise complete if no follow-up ever ships.

**Complete when:** a reader can describe the narrow promise, its source(s) of love, and its standalone useful outcome without relying on a future phase.

### 3. Draw The Boundary

Classify every material capability, behavior, interface, decision, and relevant quality requirement raised by the request or required by the narrow promise:

- **Must have:** required for this promise to be useful, lovable, and complete.
- **Later:** potentially valuable but not required for this promise.
- **Out of scope:** deliberately excluded from this concept or slice.

Resolve contradictions between the promise and its boundary by shrinking the promise or restoring a required item. Do not silently omit difficult parts.

**Complete when:** every material item raised by the request is accounted for exactly once, must-haves form an end-to-end whole, and removing any remaining must-have would break the stated promise, source of love, or completeness.

### 4. Surface Risks And Assumptions

List only uncertainties that could invalidate the audience, value, source of love, scope, usability, design, or feasibility. Convert unresolved Operator decisions into questions rather than guesses.

**Complete when:** each listed risk could change the slice or continuation decision, and no known material uncertainty is hidden in confident prose.

### 5. Choose Validation Evidence

Choose the cheapest credible evidence for the selected mode using the mode table. State what will be examined and what result would support continuing, revising, or stopping. A deliverable (for example, a mock or test suite) is not evidence until its relevant observation or result is defined. For product/tool concepts, label proxy evidence as preliminary and state how real target-customer use of the released product will provide the ultimate learning.

**Complete when:** the plan names a mode-appropriate method, the evidence sought, and a decision threshold tied to the narrow promise and source of love.

### 6. Produce And Persist The Artifact

Use the compact output shape below. Adapt labels to the mode, but do not add parallel sections that restate love, scope, or completion. Save durable project knowledge in the relevant project `library/` or task directory only when requested or required by current task context.

**Complete when:** the artifact is concise, internally consistent, understandable without private references, and stored or returned in the requested place.

### 7. Recommend Follow-Up Only When Useful

If execution should follow, recommend the smallest next task and include acceptance criteria derived from Must Have and the validation evidence. Use `next-best-actions` when prioritization among multiple follow-ups is needed. Meaningful execution should use the appropriate task flow and separate Oracle review where warranted.

**Complete when:** the recommendation is directly executable without expanding the SLC boundary, or the artifact explicitly says that no follow-up is yet justified.

## Output Shape

```markdown
# [Name] — SLC [Concept | Design | Slice]

## One-Sentence Idea

## Mode, Audience, And Job

## Narrow Promise

### Simple

### Source(s) Of Love
What creates value or affinity, and why it matters to this audience.

### Complete

## Boundary

### Must Have

### Later

### Out Of Scope

## Key Risks / Assumptions / Open Questions

## Validation Evidence
Method, evidence sought, and continue/revise/stop threshold.

## Next Task Recommendation
Only when useful; include acceptance criteria.
```

## Final Check

Before returning the artifact, verify:

- the selected mode's Simple, Lovable, Complete, audience, and validation meanings were applied;
- the narrow promise remains useful if no v2 ships;
- every material request item appears in Must Have, Later, Out of Scope, or an explicit open question;
- the source(s) of love and why they matter appear in one authoritative section;
- validation seeks evidence rather than merely naming an activity;
- unresolved Operator decisions were not invented;
- the artifact stayed proportionate to a lightweight shaping workflow.

## Pitfalls

- calling an incomplete feature fragment SLC
- removing the source of love to make the slice smaller
- using polish to disguise an incomplete core workflow or unresolved design
- treating design approval alone as customer evidence, or tests alone as evidence of customer value
- turning the artifact into a heavyweight requirements or architecture process
- depending on private or unavailable references

## Reference

- [SLC: Simple, Lovable, Complete](https://longform.asmartbear.com/slc/)

This skill remains usable without external access.

## Related Files / Tools

- task `TASK.md`, `HANDOFF.md`, and `CONTEXT.md` for task-scoped work
- project `library/` for durable project knowledge
- `framework/SKILLS/next-best-actions/SKILL.md` when follow-up prioritization is needed
