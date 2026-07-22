---
name: project-self-check
description: "Reconcile a named project inconsistency or active project state; run a full historical audit only when explicitly requested."
---

# Skill: Project Self-Check

## Outcome

Produce an evidence-backed project reconciliation whose coverage is explicit: every in-scope task and project claim is aligned, corrected, or routed, without implying that excluded history was inspected.

## Entry Contract

Project task Markdown is authoritative for task truth, implementation and tests for behavior, and project `library/` files for durable project knowledge. Documentation is a claim to verify, not evidence of its own accuracy. Consult `TASKS.md` only when task-file, review, Steering Notes, relationship, or `nextActor` semantics are needed.

## Reconciliation

### 1. Gate the scope

Require a named project and select exactly one branch before inventory:

| Branch | Enter when | Include | Branch complete when |
| --- | --- | --- | --- |
| **Focused reconciliation** | The request names a task, area, inconsistency, or recent work. | Named targets plus only the task files, knowledge, docs, implementation, and metadata directly needed to reconcile them. | Every named target and directly implicated claim has one evidenced result; all other project areas are recorded as excluded. |
| **Active-project reconciliation** | The request explicitly asks for current project maintenance without a narrower target. | Nonterminal or contradictory tasks and current project claims; terminal history only when a current claim depends on it. | Every discovered nonterminal or contradictory task and every enumerated current claim has one evidenced result; unneeded history is recorded as excluded. |
| **Full historical project audit** | The request explicitly asks for a full, historical, or whole-project audit. | Every task directory, including terminal history, plus the historical knowledge, docs, and implementation corpus defined for the audit. | Every discovered task and every claim in the defined historical corpus has one evidenced result. |

Treat absent or ambiguous project-maintenance scope as a decision request: ask the Operator to choose or narrow a branch before broad inspection. A generic invocation never implies a full historical audit. Record the selected branch, included targets, and exclusions in the result.

**Complete when:** one branch and project are explicit, its inclusion boundary is enumerable, and exclusions prevent any broader coverage claim; otherwise the run has stopped with one scope question.

### 2. Inventory only the selected scope

Read project instructions and repository state, then discover only the branch's included task directories, optional Task Browser records, `library/` files, key docs, and implementation evidence. For focused work, follow direct evidence dependencies only. For active-project work, discover nonterminal or contradictory tasks and evidence for current claims without expanding into unrelated terminal history. Expand to all historical task and claim sources only in the explicit full-audit branch.

Classify each included task as terminal, nonterminal, or contradictory from task Markdown and available metadata. Name every other input as present, absent, or not applicable.

**Complete when:** every source required by the selected branch is listed, each included task is classified, and no discovered source has silently expanded the scope.

### 3. Reconcile task directories and project-local metadata

For each included task, compare `TASK.md`, current `HANDOFF.md`, stable `CONTEXT.md`, necessary run evidence, and optional metadata. Record one result: aligned, corrected, closure candidate, unresolved, or excluded by the scope gate.

Keep `HANDOFF.md` operational and `CONTEXT.md` stable. Correct project-local metadata directly only when authoritative task Markdown makes the intended value unambiguous, the correction invents no acceptance or disposition, and a fresh metadata read confirms agreement. Otherwise route incomplete or bounced work to `task-pickup`, route an evidenced acceptance, pause, concrete blockage, or wontfix to `task-closure`, or ask the Operator when the intended state cannot be established. Use the `TASKS.md` matrix for `nextActor` and relationship rules whenever those fields are involved.

**Complete when:** every included task has one result, each direct correction satisfies all three metadata gates and has a confirming read, and every routed or unresolved task has one workflow or decision owner.

### 4. Reconcile durable project knowledge

Test in-scope facts found in task files and `library/` against the selected branch's evidence. Keep transient execution state in `HANDOFF.md`, stable task-specific facts in `CONTEXT.md`, and reusable project facts or decisions in `library/`. Remove competing copies only after establishing the authoritative destination.

Promote only evidence-backed knowledge. Keep private coordination details, secrets, credentials, and internal-only notes out of public project files; retain a safe summary in the appropriate private project location when the fact must persist.

**Complete when:** every in-scope knowledge finding has one authoritative home, each promotion cites its evidence, and stale competing copies are removed or assigned one follow-up.

### 5. Reconcile documentation with implementation reality

Verify only claims included by the scope gate, using the smallest authoritative implementation, test, configuration, generated-output, or history evidence needed. Record each claim as verified, contradicted, or uncertain with its evidence path.

Correct documentation directly only when one authoritative evidence source proves the exact replacement, all affected targets are known, and the change involves no public contract, version decision, or multi-file procedure. Otherwise hand `docs-sync` the contradiction, evidence, affected or suspected targets, and unresolved scope. Keep drift detection and accounting here; route implementation work revealed by the check to a bounded tracked task.

**Complete when:** every included claim has a disposition, each direct docs correction passes all three correction gates, and every delegated repair or implementation gap has a bounded handoff.

### 6. Verify and report

Re-read changed task, metadata, knowledge, and documentation state. Inspect the scoped diff and repository status, run `git diff --check`, and run focused automated checks when changed artifacts have applicable checks. Distinguish pre-existing work from this reconciliation and preserve it.

Report the selected branch, inclusions, exclusions, task results, metadata corrections, closure candidates, knowledge promotions, documentation/implementation findings, validation evidence, and remaining owners.

**Complete when:** the selected branch's completion boundary passes, fresh reads agree across authoritative sources, every remaining issue has one owner and next action, and the report claims no excluded or delegated work.

## Companion Routing

- Use `self-check` for workspace-level active context, repository coordination, cross-project metadata, and workspace-skill collisions.
- Use `docs-sync` when a documentation correction fails any direct-correction gate.
- Use `task-closure` for an evidenced completion, pause, blockage, or wontfix disposition.
- Use `task-pickup` for incomplete, bounced, or newly scoped implementation work.
