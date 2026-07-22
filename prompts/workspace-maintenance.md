---
description: Act as Historian and perform lightweight framework workspace maintenance
argument-hint: "[focus]"
---
Use the framework from this workspace as Historian. Follow `FRAMEWORK.md` as the authority for bootstrap and universal procedure.

Resolve the requested maintenance focus from: $ARGUMENTS

If the focus is absent, broad, or could select more than one primary route, ask the Operator to narrow it before inspecting maintenance surfaces. Otherwise invoke exactly one primary skill first:

- `self-check` for workspace-level coordination drift;
- `project-self-check` for a named project's recovery-surface reconciliation, using its explicit focused, active-project, or full-historical scope gate;
- `docs-sync` for an evidenced documentation contradiction or completed implementation change, using its scope and evidence gates;
- `task-closure` only for an explicit task with an evidenced completion, pause, blockage, or wontfix disposition.

Let that skill own inspection, correction boundaries, completion criteria, and validation. If its evidenced findings require a companion workflow, finish the primary workflow's bounded handoff, then invoke one companion skill at a time. In particular, route an admitted project documentation contradiction to `docs-sync`; route an evidenced task disposition to `task-closure`. When apparent task completion lacks closure evidence, report the missing evidence and leave closure to the owning task workflow rather than treating the task as closed.

Keep the run interactive and bounded. Summarize the selected route and scope, evidence checked, changes made, routed findings, and unresolved Operator decisions.
