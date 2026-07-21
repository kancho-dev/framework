---
name: self-check
description: "Audit workspace-level coordination health when shared state may have drifted."
---

# Skill: Self-Check

## Outcome

Restore a recoverable workspace-level control plane: current shared context, cleanly explained repository state, consistent cross-project Task Browser metadata, and unambiguous workspace-skill precedence.

## Scope And Inputs

This skill owns workspace coordination health only. Read:

- `ACTIVE-CONTEXT.md`;
- repository status for workspace repositories relevant to reported shared state;
- workspace-custom and framework skill directory names plus their `INDEX.md` files when either skill scope exists; load an individual `SKILL.md` only when the indexes and workspace guidance do not establish collision intent;
- Task Browser metadata and its CLI only when the workspace uses Task Browser.

Route project task/library/doc drift to `project-self-check`, documentation accuracy to `docs-sync`, and task disposition to `task-closure`. `TASKS.md` owns task-file, Steering Notes, review, and `nextActor` semantics; load it only when resolving a contradiction in that contract.

## Workspace Audit

1. **Establish the snapshot.** Inspect the listed inputs that exist. Identify the workspace repositories and optional Task Browser/skill scopes from workspace instructions and configuration rather than assuming a layout.
   - Complete when every applicable input is named as present, absent, or intentionally out of scope.
2. **Reconcile active context.** Test each current priority, active item, blocker, and repository claim in `ACTIVE-CONTEXT.md` against available workspace-level evidence. Before pruning, classify useful material: retain concise actionable or orienting workspace state; route durable project knowledge to the appropriate project library; and route durable workaround or lesson material to `FIXES.md` when applicable. Remove only obsolete or duplicated detail, keeping the file minimal because every main session reads it.
   - Complete when every consequential shared-state claim is supported, corrected, or explicitly marked uncertain; each retained detail helps a later session orient or act; and removed useful material has an authoritative durable destination.
3. **Explain repository hygiene.** Inspect relevant repository statuses for unexpected modifications, untracked artifacts, branch divergence, or edits in read-only/generated locations. Preserve legitimate work and report ownership or a next action for each anomaly; remove or revert only artifacts whose disposition is certain and safe.
   - Complete when every observed anomaly is resolved or has an explicit owner and next action, and no legitimate work was discarded.
4. **Check cross-project Task Browser consistency.** When Task Browser is present, use its supported inspection/metadata CLI to test workspace-global board integrity: task keys and paths resolve, display identifiers are globally unambiguous, cross-project relationships point to existing tasks, and board summaries do not contradict `ACTIVE-CONTEXT.md`. Correct workspace-global metadata only when authoritative task Markdown and path evidence make the correction unambiguous, keeping task Markdown as the source of truth and using real provenance when available. Route project-local status or content reconciliation to `project-self-check`, `nextActor` or handoff mismatches to the authoritative task workflow or `project-self-check`, and acceptance or disposition to `task-closure`; when correction authority remains ambiguous, leave the metadata intact and request clarification or route it to the responsible workflow.
   - Complete when every workspace-global contradiction is corrected from unambiguous authoritative evidence or has one explicit clarification/routing destination, every project-local contradiction is routed to its owning workflow, and a fresh read confirms each applied correction. If Task Browser is absent, record this branch as not applicable.
5. **Resolve workspace-skill collisions.** Compare workspace-custom skill names with framework skill names and inspect indexes for explicit override intent. Keep an intentional override only when workspace or Operator guidance says so; otherwise leave both intact, record the collision, and request the Operator's rename-or-override decision.
   - Complete when every collision is documented as intentional or awaiting one explicit decision, and every non-colliding index entry resolves to its named skill. If either scope is absent, record this branch as not applicable.
6. **Close the audit.** Re-read changed shared files and fresh repository/metadata status. Summarize corrections, unresolved anomalies with owners, and the next workspace action.
   - Complete when another session can recover current coordination state from workspace files without chat history and every unresolved item has one next action.

## Self-Check Complete When

- `ACTIVE-CONTEXT.md` is concise and evidence-aligned;
- repository anomalies, cross-project metadata issues, and skill collisions are each resolved or explicitly routed;
- project maintenance, docs synchronization, and task closure remain with their companion workflows;
- the final fresh read exposes no unexplained workspace-level contradiction.

## Companion Routing

- Use `project-self-check` for one project's task state, library, implementation, and documentation alignment.
- Use `docs-sync` for documentation-to-reality repair.
- Use `task-closure` only after an evidenced task disposition.
- Consult `TASKS.md` for universal task semantics, and `SKILLS.md` for skill precedence details.
