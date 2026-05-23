---
name: slc-product-concept
description: "Shape a product, design, or implementation idea as Simple, Lovable, and Complete before planning execution."
---

# Skill: SLC Product Concept

## Purpose

Shape a product, tool, design, architecture, or implementation idea using the SLC principle: Simple, Lovable, and Complete.

Use this as a lightweight alternative to an MVP-style plan when the goal is to define a small slice that feels complete and valuable instead of an incomplete or embarrassing fragment.

## When To Use

- exploring a new product, tool, or prototype idea before implementation
- turning a vague idea into a crisp first product slice
- shaping a design or architecture proposal into a narrow complete spec
- scoping an implementation slice that should be useful on its own
- preparing a task that should create a concept, PRD, design note, or first-slice plan
- evaluating whether an idea is too broad for one coherent first release

## Recommended Roles

- Overseer for concept shaping and task scoping
- Builder when drafting the concept artifact or implementation slice
- Oracle when reviewing whether the concept is truly SLC

## Required Inputs

- Operator's idea, problem statement, design question, or implementation goal
- target users/audience, if known
- relevant project/workspace constraints
- known examples, references, or prior attempts when available
- intended output location, such as a task file, project `library/` artifact, or concise chat summary

## SLC Meaning

- **Simple:** small enough to build, explain, and validate quickly. It does not claim to do more than it does.
- **Lovable:** gives users a genuine reason to want it, through delight, sharp positioning, emotional connection, workflow fit, transparency, identity, speed, craft, or another form of love.
- **Complete:** accomplishes a coherent job inside a deliberately narrow scope. Users get v1 of something simple, not v0.1 of something broken.

SLC does not mean unfinished, cheap, or minimal at the expense of usefulness. A strong SLC is delightful and useful on day one within its narrow scope. If no further investment happens, it should still provide value as a modest complete product, design, or implementation slice.

## Steps

1. Clarify the core user and job-to-be-done.
2. Write the idea in one sentence.
3. Decide which mode fits the request:
   - **Product/tool concept:** define the user-facing workflow and why someone would choose it.
   - **Design/architecture spec:** define the narrow decision, quality bar, interfaces, tradeoffs, and what complexity is intentionally excluded.
   - **Implementation slice:** define the smallest shippable change that is useful, reviewable, and complete with docs/tests/polish appropriate to the slice.
4. Define the SLC slice:
   - what is the smallest complete workflow, decision, or job?
   - what makes it lovable or compelling, not merely functional?
   - which form of love does this concept choose, such as elegant UX, emotional connection, workflow fit, transparency, identity, speed, or craft?
   - what complexity is intentionally excluded?
   - would this still be valuable if no v2 ever ships?
5. Separate the concept into:
   - must-have for the first complete slice;
   - nice later;
   - explicitly out of scope.
6. Identify the riskiest assumptions:
   - user value risk;
   - love/delight risk;
   - usability risk;
   - technical/design risk;
   - scope risk.
7. Propose a validation path:
   - demo, prototype, mock, design review, manual workflow, or small implementation;
   - what evidence would make the concept worth continuing?
8. Produce a concise concept artifact using this shape, adapting headings to the selected mode:

```markdown
# [Product/Feature/Design Name] — SLC Concept

## One-Sentence Idea

## Target User / Job

## Mode

Product/tool concept, design/architecture spec, or implementation slice.

## Simple

## Lovable

## Complete

## First Slice

### Must Have

### Later

### Out Of Scope

## Why Users Would Love It

## Chosen Form Of Love

## Key Risks / Assumptions

## Validation Plan

## Next Task Recommendation
```

9. If the concept creates durable project knowledge, save or summarize it in the relevant project `library/` or task directory.
10. If implementation should follow, recommend the smallest next task with acceptance criteria.

## Outputs

- a concise SLC concept artifact
- explicit first-slice must-have/later/out-of-scope boundaries
- clear reason users would love the narrow slice
- risk/assumption list
- validation plan
- recommended next task, when appropriate

## Stop Conditions

- the first slice is small, lovable, and complete as an end-to-end experience, design decision, or implementation change
- the concept explains why users would choose or enjoy it despite narrow scope
- excluded complexity is explicit
- the next validation or implementation step is clear
- unresolved Operator decisions are listed as questions rather than guessed

## Pitfalls / Anti-Patterns

- calling an incomplete feature fragment “SLC”
- making the slice simple by removing the part that makes it lovable
- making it lovable with polish while the core workflow remains incomplete
- turning the skill into a heavyweight PRD process
- confusing a broad architecture vision with a complete narrow design slice
- depending on private/local reference files that future agents cannot access

## References

- Original article: [SLC: Simple, Lovable, Complete](https://longform.asmartbear.com/slc/)

The skill should remain usable without external access.

## Related Files / Tools

- task `TASK.md`, `HANDOFF.md`, `CONTEXT.md` when concept work happens inside a task
- project `library/` files when the concept becomes durable project knowledge
- `framework/SKILLS/next-best-actions/SKILL.md` for choosing follow-up work
