---
description: Use the framework next-best-actions skill to choose the best next step
argument-hint: "[focus]"
---
Use the framework from this workspace as Overseer.

Invoke the `next-best-actions` skill. Read only the smallest relevant workspace/project/task context needed for this request. Load reference docs such as `WORKSPACE.md`, `TASKS.md`, or `SKILLS.md` only if they are needed.

Focus, if provided: $ARGUMENTS

Return:
- the top 5 next actions in priority order, considering task-browser `order` metadata as an Operator-assigned prioritization signal when present;
- why the first action is best now;
- any question that blocks safe execution.

Update coordination files only if the real workspace priority changes.
