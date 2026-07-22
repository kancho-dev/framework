---
name: next-best-actions
description: "Prioritize the highest-value next actions from current workspace or project state, including work that needs Operator attention."
---

# Skill: Next Best Actions

## Outcome

Produce a bounded, evidence-backed action queue that makes Operator attention visible while preserving value, urgency, blockers, and lifecycle state.

## Entry Contract

Task status, ownership, assignment, and `nextActor` are separate concepts. `nextActor: operator` means a concrete Operator action is needed for the task to advance; it is an attention signal, not a status or ownership claim. Task files remain authoritative when Task Browser metadata conflicts.

## Required Inputs

- the requested workspace, project, or task focus;
- `ACTIVE-CONTEXT.md` and today's daily brief, or the latest brief when today's does not exist;
- relevant task handoffs, project knowledge, or `OPERATOR-NOTES.md` only when they can change the focused decision;
- Task Browser metadata when the workspace uses it, including `status`, `priority`, `order`, `nextActor`, and blockers.

## Prioritization Sequence

### 1. Frame the decision

Define the requested focus and the maximum action count. Read the smallest current-state set that reveals active work, accepted direction, and concrete decisions; follow pointers into task or project files only when a candidate depends on them.

**Complete when:** the focus, output bound, and authoritative source for every candidate class are named.

### 2. Build the candidate lanes

Classify each actionable candidate without collapsing its fields:

- **Operator attention:** `nextActor: operator` and a concrete approval, decision, input, review, or manual action;
- **Agent action:** `nextActor: agent` and executable implementation, research, planning, or review work;
- **No current actor:** nullable `nextActor` for paused, done, external/no-action, or otherwise non-actionable work.

Record lifecycle status, blockers, ownership or assignment only when explicitly sourced, and any numeric `order` independently. Reconcile metadata against task handoffs; use task markdown as truth and report material drift.

**Complete when:** every considered candidate has a sourced actionability lane, lifecycle state, blocker state, and actor signal, with conflicts identified rather than inferred away.

### 3. Rank by leverage

Rank actionable candidates by:

1. concrete urgency or risk;
2. value unlocked, especially removal of a decision or blocker;
3. completion of active, nearly finished work;
4. value-to-complexity ratio;
5. Operator-assigned `order` within otherwise comparable status and priority bands, with lower numbers first.

Operator attention is a distinct lane and often high leverage, but it is not an automatic status or rank override. Exclude done work and candidates without a concrete next action. Keep blocked work only when the recommended action resolves the blocker.

**Complete when:** every retained action has a source-backed reason for its position and every omitted higher-looking candidate has an explainable blocker, lower leverage, or no actionable step.

### 4. Present the queue

Return no more than the requested maximum, five by default. For each recommendation state:

- the concrete next action and intended actor;
- why it ranks here;
- authoritative source;
- lifecycle status and blocker, when relevant.

Mark Operator-attention items explicitly and group or label them so they cannot disappear inside Agent work. Explain why the first action is best now and name any question that blocks safe execution.

**Complete when:** the queue is ordered, bounded, actionable, sourced, and visibly distinguishes every included Operator-attention item from status and ownership.

### 5. Reconcile changed direction

Update `ACTIVE-CONTEXT.md`, task handoffs, or Task Browser metadata only when this run makes a real priority or actor decision. Apply status and `nextActor` independently using `TASKS.md`; preserve existing state when the run only reports recommendations.

**Complete when:** changed decisions are aligned across their authoritative files and metadata, or the run records that no coordination state changed.

## Output Contract

- **Prioritized actions:** up to the requested maximum, with actor, rationale, source, status, and blocker where applicable;
- **Operator attention:** an explicit subset or `none`;
- **Why first:** the leverage case for the top action;
- **Blocking question:** only when safe execution needs an answer;
- **State updates:** files or metadata changed, or `none`.

## Companion Routing

- Use `task-pickup` after choosing a tracked task for a bounded implementation or review action.
- Use `review-and-test` for an independent review action.
