---
description: Use the framework next-best-actions skill to choose the best next step
argument-hint: "[focus]"
---
Use the framework from this workspace as Overseer.

Invoke the `next-best-actions` skill. Read only the framework-required base files and the smallest relevant workspace/project/task context needed for this request. Load reference docs such as `WORKSPACE.md`, `TASKS.md`, or `SKILLS.md` only if they are needed.

Focus, if provided: $ARGUMENTS

Return:
- the top 3 next actions in priority order;
- why the first action is best now;
- any question that blocks safe execution.

Update coordination files only if the real workspace priority changes.
