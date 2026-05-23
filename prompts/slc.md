---
description: Shape an idea as Simple, Lovable, and Complete before planning implementation
argument-hint: "[product|design|slice] [idea]"
---
Use the framework from this workspace as Overseer.

Invoke the `slc-product-concept` skill. Read only the framework-required base files and the smallest relevant workspace/project/task context needed for this request. Load reference docs such as `WORKSPACE.md`, `TASKS.md`, or `SKILLS.md` only if they are needed.

Request: $ARGUMENTS

Interpret the request as one of these modes when possible:
- product/tool concept: shape a user-facing product, tool, or prototype idea;
- design/architecture spec: shape a narrow complete design decision or architecture slice;
- implementation slice: scope the smallest lovable, complete implementation change with appropriate docs/tests/polish.

If the mode is unclear, choose the most likely mode from the request and state the assumption. Ask a concise question only when the ambiguity blocks useful SLC shaping.

Return:
- a concise SLC concept artifact;
- must-have, later, and out-of-scope boundaries;
- the chosen form of love;
- key risks/assumptions;
- validation plan;
- recommended next task or implementation slice with acceptance criteria when useful.

Do not create or edit files unless the user asks for a durable artifact/task or the current framework/task context already requires it. If creating implementation tasks or changing code/docs, follow the framework task and engineering rules.
